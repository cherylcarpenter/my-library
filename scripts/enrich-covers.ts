/**
 * Enrich books missing covers using Google Books API
 * Run with: npx tsx scripts/enrich-covers.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// Rate limit: 1 request per 100ms to be nice to Google
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function getGoogleBooksCover(title: string, authorName: string): Promise<string | null> {
  try {
    const query = encodeURIComponent(`${title} inauthor:${authorName}`);
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const thumbnail = data.items?.[0]?.volumeInfo?.imageLinks?.thumbnail;
    if (!thumbnail) return null;
    
    // Convert to https and get larger image
    const coverUrl = thumbnail.replace('http://', 'https://').replace('zoom=1', 'zoom=2');
    
    // Skip known placeholder ID
    if (coverUrl.includes('id=UNJMswEACAAJ')) return null;
    
    // Validate it's a real image (> 1KB)
    return await isValidCover(coverUrl) ? coverUrl : null;
  } catch {
    return null;
  }
}

// Known placeholder sizes (bytes)
const PLACEHOLDER_SIZES = new Set([
  43,     // OpenLibrary 1x1 GIF
  15567,  // Google Books "image not available" PNG
]);

async function isValidCover(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return false;
    const buffer = await res.arrayBuffer();
    // Reject known placeholder sizes and tiny images
    if (buffer.byteLength < 1000 || PLACEHOLDER_SIZES.has(buffer.byteLength)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function getOpenLibraryCover(isbn: string | null, title: string): Promise<string | null> {
  try {
    if (isbn) {
      // Try by ISBN first
      const isbnCover = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
      if (await isValidCover(isbnCover)) {
        return isbnCover;
      }
    }
    
    // Try searching by title
    const searchRes = await fetch(
      `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&limit=1`
    );
    if (!searchRes.ok) return null;
    const data = await searchRes.json();
    const coverId = data.docs?.[0]?.cover_i;
    if (!coverId) return null;
    
    const coverUrl = `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
    return await isValidCover(coverUrl) ? coverUrl : null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('📚 Finding books without covers...\n');
  
  const booksWithoutCovers = await prisma.book.findMany({
    where: {
      coverUrl: null,
    },
    include: {
      authors: {
        include: {
          author: {
            select: { name: true }
          }
        },
        take: 1
      }
    }
  });
  
  console.log(`Found ${booksWithoutCovers.length} books without covers\n`);
  
  let found = 0;
  let notFound = 0;
  
  for (const book of booksWithoutCovers) {
    const authorName = book.authors[0]?.author?.name || '';
    const isbn = book.isbn13 || book.isbn;
    
    process.stdout.write(`Checking: ${book.title.substring(0, 50).padEnd(50)} `);
    
    // Try OpenLibrary first (ISBN = exact match, reliable covers)
    let coverUrl = await getOpenLibraryCover(isbn, book.title);
    
    // Fall back to Google Books if OpenLibrary didn't have it
    if (!coverUrl) {
      await delay(100);
      coverUrl = await getGoogleBooksCover(book.title, authorName);
    }
    
    if (coverUrl) {
      await prisma.book.update({
        where: { id: book.id },
        data: { coverUrl }
      });
      console.log('✓ Found');
      found++;
    } else {
      console.log('✗ Not found');
      notFound++;
    }
    
    await delay(100); // Rate limiting
  }
  
  console.log(`\n📊 Results:`);
  console.log(`   Found covers: ${found}`);
  console.log(`   Not found: ${notFound}`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
