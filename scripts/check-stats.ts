import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const totalBooks = await prisma.book.count();
  const booksWithDesc = await prisma.book.count({ where: { description: { not: null } } });
  const booksWithCover = await prisma.book.count({ where: { coverUrl: { not: null } } });
  const enrichedBooks = await prisma.book.count({ where: { enrichmentStatus: 'ENRICHED' } });
  
  const totalAuthors = await prisma.author.count();
  const authorsWithBio = await prisma.author.count({ where: { bio: { not: null } } });
  const authorsWithPhoto = await prisma.author.count({ where: { photoUrl: { not: null } } });
  
  console.log('=== 📚 LIBRARY ENRICHMENT STATS ===\n');
  
  console.log('📖 BOOKS');
  console.log(`  Total: ${totalBooks}`);
  console.log(`  With descriptions: ${booksWithDesc} (${(booksWithDesc/totalBooks*100).toFixed(1)}%)`);
  console.log(`  With covers: ${booksWithCover} (${(booksWithCover/totalBooks*100).toFixed(1)}%)`);
  console.log(`  Recently enriched: ${enrichedBooks}`);
  
  console.log('\n👤 AUTHORS');
  console.log(`  Total: ${totalAuthors}`);
  console.log(`  With bios: ${authorsWithBio} (${(authorsWithBio/totalAuthors*100).toFixed(1)}%)`);
  console.log(`  With photos: ${authorsWithPhoto} (${(authorsWithPhoto/totalAuthors*100).toFixed(1)}%)`);
  
  console.log('\n🎯 IMPROVEMENT');
  console.log(`  Before: 492 books with descriptions`);
  console.log(`  After: ${booksWithDesc} books with descriptions`);
  console.log(`  Gain: +${booksWithDesc - 492} (${((booksWithDesc - 492)/492*100).toFixed(1)}% increase)`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());