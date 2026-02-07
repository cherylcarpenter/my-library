/**
 * Try Google Books for remaining books without covers
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const BATCH_SIZE = 25;
const PLACEHOLDER_SIZES = new Set([43, 15567]);

async function isValidCover(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return false;
    const buffer = await res.arrayBuffer();
    return buffer.byteLength > 1000 && !PLACEHOLDER_SIZES.has(buffer.byteLength);
  } catch { return false; }
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
    if (coverUrl.includes('id=UNJMswEACAAJ')) return null;
    
    return await isValidCover(coverUrl) ? coverUrl : null;
  } catch { return null; }
}

async function main() {
  console.log('📚 Trying Google Books for remaining books...\n');
  
  const books = await prisma.book.findMany({
    where: { coverUrl: null },
    select: { 
      id: true, 
      title: true,
      authors: { select: { author: { select: { name: true } } } }
    }
  });

  console.log(`Found ${books.length} books without covers\n`);
  
  let found = 0, notFound = 0;

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    const author = book.authors[0]?.author?.name;
    
    const coverUrl = await getGoogleBooksCover(book.title, author);
    
    if (coverUrl) {
      await prisma.book.update({
        where: { id: book.id },
        data: { coverUrl }
      });
      console.log(`✅ ${book.title}`);
      found++;
    } else {
      notFound++;
    }
    
    // Progress every 25
    if ((i + 1) % 25 === 0) {
      console.log(`... processed ${i + 1}/${books.length}`);
    }
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(`Found:     ${found}`);
  console.log(`Not found: ${notFound}`);
  console.log(`════════════════════════════════════════`);

  await pool.end();
}

main();
