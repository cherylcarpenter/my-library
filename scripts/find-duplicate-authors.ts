import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function findDuplicates() {
  // Find authors with the same name
  const authors = await prisma.author.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      _count: { select: { books: true } }
    },
    orderBy: { name: 'asc' }
  });

  // Group by normalized name
  const byName = new Map<string, typeof authors>();
  for (const author of authors) {
    const key = author.name.toLowerCase().trim();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(author);
  }

  // Find duplicates (same name, multiple records)
  const duplicates = [...byName.entries()]
    .filter(([_, authors]) => authors.length > 1)
    .map(([name, authors]) => ({
      name,
      count: authors.length,
      authors: authors.map(a => ({ 
        id: a.id, 
        slug: a.slug, 
        books: a._count.books 
      }))
    }));

  console.log(`Found ${duplicates.length} authors with duplicates:\n`);
  
  for (const dup of duplicates.slice(0, 20)) {
    console.log(`"${dup.authors[0].slug}" (${dup.count} records):`);
    for (const a of dup.authors) {
      console.log(`  - ${a.slug}: ${a.books} books`);
    }
  }
  
  if (duplicates.length > 20) {
    console.log(`\n... and ${duplicates.length - 20} more`);
  }
  
  console.log(`\nTotal duplicate groups: ${duplicates.length}`);
  console.log(`Total extra records to merge: ${duplicates.reduce((sum, d) => sum + d.count - 1, 0)}`);
  
  await prisma.$disconnect();
  await pool.end();
}

findDuplicates().catch(console.error);
