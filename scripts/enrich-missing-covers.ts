/**
 * Enrich missing covers - batch processing with resume support
 * Run with: npx tsx scripts/enrich-missing-covers.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const BATCH_SIZE = 50;
const PLACEHOLDER_SIZES = new Set([43, 15567]);

async function isValidCover(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return false;
    const buffer = await res.arrayBuffer();
    return buffer.byteLength > 1000 && !PLACEHOLDER_SIZES.has(buffer.byteLength);
  } catch { return false; }
}

async function processBatch(offset: number): Promise<{ found: number; notFound: number; total: number }> {
  const books = await prisma.book.findMany({
    where: { 
      coverUrl: null,
      OR: [{ isbn: { not: null } }, { isbn13: { not: null } }]
    },
    select: { id: true, title: true, isbn: true, isbn13: true },
    take: BATCH_SIZE,
    skip: 0 // Always take from the top since we're updating them
  });

  if (books.length === 0) {
    return { found: 0, notFound: 0, total: 0 };
  }

  let found = 0, notFound = 0;

  for (const book of books) {
    const isbn = book.isbn13 || book.isbn;
    if (!isbn) { notFound++; continue; }
    
    const url = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
    if (await isValidCover(url)) {
      await prisma.book.update({
        where: { id: book.id },
        data: { coverUrl: url }
      });
      console.log(`✅ ${book.title}`);
      found++;
    } else {
      // Mark as checked by setting empty string (so we don't retry)
      // Actually, let's just skip - leave as null for now
      notFound++;
    }
  }

  return { found, notFound, total: books.length };
}

async function main() {
  console.log('📚 Enriching missing covers in batches...\n');
  
  let totalFound = 0, totalNotFound = 0, batchNum = 0;
  
  while (true) {
    batchNum++;
    const result = await processBatch(0);
    
    if (result.total === 0) {
      console.log('\n✅ All books processed!');
      break;
    }
    
    totalFound += result.found;
    totalNotFound += result.notFound;
    
    console.log(`\n--- Batch ${batchNum}: ${result.found} found, ${result.notFound} not found ---\n`);
    
    // If we found nothing in this batch, we're done (remaining books have no covers available)
    if (result.found === 0) {
      console.log('No more covers found. Stopping.');
      break;
    }
  }

  // Get final count
  const remaining = await prisma.book.count({
    where: { coverUrl: null }
  });

  console.log(`\n════════════════════════════════════════`);
  console.log(`Total found:     ${totalFound}`);
  console.log(`Total not found: ${totalNotFound}`);
  console.log(`Still missing:   ${remaining}`);
  console.log(`════════════════════════════════════════`);

  await pool.end();
}

main();
