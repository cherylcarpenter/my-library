/**
 * Enrich covers using OpenLibrary Work IDs
 * For books where ISBN lookup failed but we have the work ID
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function getCoverFromWork(workId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://openlibrary.org/works/${workId}.json`);
    if (!res.ok) return null;
    
    const data = await res.json();
    const coverId = data.covers?.[0];
    
    if (!coverId || coverId < 0) return null;
    
    // Return the cover URL (large size)
    return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
  } catch {
    return null;
  }
}

async function main() {
  const books = await prisma.book.findMany({
    where: {
      AND: [
        { openLibraryId: { not: null } },
        { OR: [{ coverUrl: null }, { coverUrl: "" }] }
      ]
    },
    select: { id: true, title: true, openLibraryId: true }
  });

  console.log(`Found ${books.length} books with OpenLibrary ID but no cover\n`);

  let found = 0;
  let notFound = 0;

  for (const book of books) {
    const coverUrl = await getCoverFromWork(book.openLibraryId!);
    
    if (coverUrl) {
      await prisma.book.update({
        where: { id: book.id },
        data: { coverUrl }
      });
      console.log(`✅ ${book.title}`);
      found++;
    } else {
      console.log(`❌ ${book.title} (no cover in work data)`);
      notFound++;
    }
    
    await delay(100); // Be nice to OpenLibrary
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(`Found covers: ${found}`);
  console.log(`Not found:    ${notFound}`);
  console.log(`════════════════════════════════════════`);

  await pool.end();
}

main();
