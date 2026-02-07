/**
 * Find and fix OpenLibrary placeholder covers (1x1 GIFs)
 * Processes in parallel for speed
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const CONCURRENCY = 10; // Process 10 at a time

async function checkCoverSize(url: string): Promise<number> {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return 0;
    const buffer = await res.arrayBuffer();
    return buffer.byteLength;
  } catch {
    return 0;
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
    if (coverUrl.includes('id=UNJMswEACAAJ')) return null; // Known placeholder
    
    // Verify it's a real image
    const size = await checkCoverSize(coverUrl);
    return size > 1000 ? coverUrl : null;
  } catch {
    return null;
  }
}

async function processBook(book: { id: string; title: string; coverUrl: string | null; authors: { author: { name: string } }[] }) {
  if (!book.coverUrl) {
    return { status: 'cleared' as const, title: book.title };
  }
  
  const size = await checkCoverSize(book.coverUrl);
  
  if (size > 1000) {
    return { status: 'valid' as const };
  }
  
  // Bad cover - try Google Books
  const author = book.authors[0]?.author?.name;
  const newCover = await getGoogleBooksCover(book.title, author);
  
  if (newCover) {
    await prisma.book.update({
      where: { id: book.id },
      data: { coverUrl: newCover }
    });
    return { status: 'fixed' as const, title: book.title };
  } else {
    await prisma.book.update({
      where: { id: book.id },
      data: { coverUrl: null }
    });
    return { status: 'cleared' as const, title: book.title };
  }
}

async function main() {
  const books = await prisma.book.findMany({
    where: { coverUrl: { contains: "covers.openlibrary.org" } },
    select: { 
      id: true, 
      title: true, 
      coverUrl: true,
      authors: { select: { author: { select: { name: true } } } }
    }
  });

  console.log(`Checking ${books.length} OpenLibrary covers (${CONCURRENCY} parallel)...\n`);

  let valid = 0, fixed = 0, cleared = 0;
  
  // Process in batches
  for (let i = 0; i < books.length; i += CONCURRENCY) {
    const batch = books.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(b => processBook(b)));
    
    for (const r of results) {
      if (r.status === 'valid') valid++;
      else if (r.status === 'fixed') {
        fixed++;
        console.log(`🔄 ${r.title}`);
      } else {
        cleared++;
        console.log(`❌ ${r.title}`);
      }
    }
    
    // Progress every 100
    if ((i + CONCURRENCY) % 100 === 0) {
      console.log(`... processed ${i + CONCURRENCY}/${books.length}`);
    }
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(`Valid:   ${valid}`);
  console.log(`Fixed:   ${fixed}`);
  console.log(`Cleared: ${cleared}`);
  console.log(`════════════════════════════════════════`);

  await pool.end();
}

main();
