/**
 * Restore covers for books that were incorrectly cleared
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function getOpenLibraryCover(isbn: string): Promise<string | null> {
  try {
    const url = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (!res.ok) return null;
    
    const contentLength = res.headers.get('content-length');
    // Skip if it's the 1x1 placeholder (43 bytes)
    if (contentLength && parseInt(contentLength) < 1000) return null;
    
    return url;
  } catch {
    return null;
  }
}

async function getGoogleBooksCover(title: string, author?: string): Promise<string | null> {
  try {
    const query = author 
      ? encodeURIComponent(`${title} inauthor:${author}`)
      : encodeURIComponent(title);
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const thumbnail = data.items?.[0]?.volumeInfo?.imageLinks?.thumbnail;
    if (!thumbnail) return null;
    
    const coverUrl = thumbnail.replace('http://', 'https://').replace('zoom=1', 'zoom=2');
    
    // Check it's not the placeholder
    if (coverUrl.includes('id=UNJMswEACAAJ')) return null;
    
    return coverUrl;
  } catch {
    return null;
  }
}

async function main() {
  const books = await prisma.book.findMany({
    where: { 
      AND: [
        { OR: [{ coverUrl: null }, { coverUrl: "" }] },
        { updatedAt: { gte: new Date(Date.now() - 20 * 60 * 1000) } }
      ]
    },
    select: { 
      id: true, 
      title: true, 
      isbn: true, 
      isbn13: true,
      authors: { select: { author: { select: { name: true } } } }
    }
  });

  console.log(`Attempting to restore ${books.length} covers...\n`);

  let restored = 0;
  let failed = 0;

  for (const book of books) {
    let coverUrl: string | null = null;
    
    // Try OpenLibrary first
    if (book.isbn13) {
      coverUrl = await getOpenLibraryCover(book.isbn13);
    }
    if (!coverUrl && book.isbn) {
      coverUrl = await getOpenLibraryCover(book.isbn);
    }
    
    // Try Google Books
    if (!coverUrl) {
      const author = book.authors[0]?.author?.name;
      coverUrl = await getGoogleBooksCover(book.title, author);
    }
    
    if (coverUrl) {
      await prisma.book.update({
        where: { id: book.id },
        data: { coverUrl }
      });
      console.log(`✅ ${book.title}`);
      restored++;
    } else {
      console.log(`❌ ${book.title}`);
      failed++;
    }
    
    await delay(100);
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(`Restored: ${restored}`);
  console.log(`Not found: ${failed}`);
  console.log(`════════════════════════════════════════`);

  await pool.end();
}

main();
