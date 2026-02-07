/**
 * Validate covers and replace bad ones
 * Checks that cover URLs return actual images, not placeholders
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function isValidCover(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return false;
    
    const buffer = await res.arrayBuffer();
    // Placeholder GIFs are 43 bytes, real covers are much larger
    return buffer.byteLength > 1000;
  } catch {
    return false;
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
    
    // Check it's not the known placeholder ID
    if (coverUrl.includes('id=UNJMswEACAAJ')) return null;
    
    return coverUrl;
  } catch {
    return null;
  }
}

async function main() {
  // Find all books with OpenLibrary cover URLs
  const books = await prisma.book.findMany({
    where: { coverUrl: { contains: "covers.openlibrary.org" } },
    select: { 
      id: true, 
      title: true, 
      coverUrl: true,
      authors: { select: { author: { select: { name: true } } } }
    }
  });

  console.log(`Checking ${books.length} OpenLibrary covers...\n`);

  let valid = 0;
  let fixed = 0;
  let unfixable = 0;

  for (const book of books) {
    const isValid = await isValidCover(book.coverUrl!);
    
    if (isValid) {
      valid++;
    } else {
      // Try Google Books
      const author = book.authors[0]?.author?.name;
      const newCover = await getGoogleBooksCover(book.title, author);
      
      if (newCover && await isValidCover(newCover)) {
        await prisma.book.update({
          where: { id: book.id },
          data: { coverUrl: newCover }
        });
        console.log(`🔄 ${book.title} → Google Books`);
        fixed++;
      } else {
        await prisma.book.update({
          where: { id: book.id },
          data: { coverUrl: null }
        });
        console.log(`❌ ${book.title} → cleared (no valid source)`);
        unfixable++;
      }
    }
    
    await delay(100);
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(`Valid:     ${valid}`);
  console.log(`Fixed:     ${fixed}`);
  console.log(`Cleared:   ${unfixable}`);
  console.log(`════════════════════════════════════════`);

  await pool.end();
}

main();
