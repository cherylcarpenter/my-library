/**
 * Merge duplicate series - keeps the one with most books, moves books from others
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  console.log('📚 Finding duplicate series...\n');
  
  const series = await prisma.series.findMany({
    select: { id: true, name: true, slug: true, _count: { select: { books: true } } }
  });
  
  // Group by normalized name (lowercase, trimmed)
  const byName: Record<string, typeof series> = {};
  for (const s of series) {
    const key = s.name.toLowerCase().trim();
    if (!byName[key]) byName[key] = [];
    byName[key].push(s);
  }
  
  // Find duplicates
  const duplicates = Object.entries(byName).filter(([_, arr]) => arr.length > 1);
  
  console.log(`Found ${duplicates.length} duplicate series names\n`);
  
  let mergedCount = 0;
  let deletedCount = 0;
  
  for (const [name, arr] of duplicates) {
    // Sort by book count descending - keep the one with most books
    arr.sort((a, b) => b._count.books - a._count.books);
    const keeper = arr[0];
    const toMerge = arr.slice(1);
    
    // Move all books from duplicates to keeper
    for (const dup of toMerge) {
      if (dup._count.books > 0) {
        await prisma.book.updateMany({
          where: { seriesId: dup.id },
          data: { seriesId: keeper.id }
        });
        console.log(`  Moved ${dup._count.books} books from "${dup.name}" (${dup.slug}) to ${keeper.slug}`);
        mergedCount += dup._count.books;
      }
      
      // Delete the empty series
      await prisma.series.delete({ where: { id: dup.id } });
      deletedCount++;
    }
  }
  
  // Also delete series with 0 books
  const emptySeries = await prisma.series.findMany({
    where: { books: { none: {} } },
    select: { id: true, name: true }
  });
  
  if (emptySeries.length > 0) {
    console.log(`\nDeleting ${emptySeries.length} empty series...`);
    await prisma.series.deleteMany({
      where: { id: { in: emptySeries.map(s => s.id) } }
    });
    deletedCount += emptySeries.length;
  }
  
  // Final count
  const finalCount = await prisma.series.count();
  
  console.log(`\n════════════════════════════════════════`);
  console.log(`Books moved:      ${mergedCount}`);
  console.log(`Series deleted:   ${deletedCount}`);
  console.log(`Series remaining: ${finalCount}`);
  console.log(`════════════════════════════════════════`);
  
  await pool.end();
}

main();
