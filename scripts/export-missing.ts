/**
 * Export Books Needing Review (for Manual Research)
 * 
 * Usage:
 *   npx tsx scripts/export-missing.ts
 * 
 * Outputs:
 *   - missing-books.csv: Books needing descriptions
 *   - wrong-covers.csv: Books with covers (review for accuracy)
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { writeFileSync } from 'fs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  console.log('=== Export Missing Data ===\n');
  
  // 1. Export books missing descriptions
  const missingDesc = await prisma.book.findMany({
    where: { description: null },
    include: {
      authors: {
        include: {
          author: { select: { name: true } }
        }
      }
    },
    orderBy: { title: 'asc' }
  });
  
  const descCSV = [
    'title,author,isbn,openLibraryId,url',
    ...missingDesc.map(b => {
      const author = b.authors[0]?.author?.name || '';
      const isbn = b.isbn || '';
      const olid = b.openLibraryId || '';
      const url = olid ? `https://openlibrary.org/works/${olid}` : '';
      return `"${b.title}","${author}","${isbn}","${olid}","${url}"`;
    })
  ].join('\n');
  
  writeFileSync('missing-descriptions.csv', descCSV);
  console.log(`✅ missing-descriptions.csv: ${missingDesc.length} books`);
  
  // 2. Export books with covers (for wrong-cover review)
  const withCovers = await prisma.book.findMany({
    where: { coverUrl: { not: null } },
    include: {
      authors: {
        include: {
          author: { select: { name: true } }
        }
      }
    },
    orderBy: { title: 'asc' },
    take: 500
  });
  
  const coversCSV = [
    'title,author,coverUrl,openLibraryId,url',
    ...withCovers.map(b => {
      const author = b.authors[0]?.author?.name || '';
      const url = b.openLibraryId ? `https://openlibrary.org/works/${b.openLibraryId}` : '';
      return `"${b.title}","${author}","${b.coverUrl}","${b.openLibraryId || ''}","${url}"`;
    })
  ].join('\n');
  
  writeFileSync('covers-review.csv', coversCSV);
  console.log(`✅ covers-review.csv: ${withCovers.length} books (sample)`);
  
  // 3. Export summary stats
  const stats = await prisma.book.groupBy({
    by: ['enrichmentStatus'],
    _count: true
  });
  
  console.log('\n=== Enrichment Status ===');
  stats.forEach(s => {
    console.log(`  ${s.enrichmentStatus}: ${s._count}`);
  });
  
  const totalBooks = await prisma.book.count();
  const withDesc = await prisma.book.count({ where: { description: { not: null } } });
  const withCover = await prisma.book.count({ where: { coverUrl: { not: null } } });
  
  console.log('\n=== Coverage ===');
  console.log(`  Total books: ${totalBooks}`);
  console.log(`  With descriptions: ${withDesc} (${(withDesc/totalBooks*100).toFixed(1)}%)`);
  console.log(`  With covers: ${withCover} (${(withCover/totalBooks*100).toFixed(1)}%)`);
  
  console.log('\n=== Files Created ===');
  console.log('  - missing-descriptions.csv (for manual research)');
  console.log('  - covers-review.csv (for wrong-cover review)');
  console.log('\nManual research: Search each title on Amazon/Goodreads, copy description.');
  console.log('Cover review: Open CSV, verify cover URLs match books.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());