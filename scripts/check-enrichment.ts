import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const booksWithCover = await prisma.book.count({ where: { coverUrl: { not: null } } });
  const totalBooks = await prisma.book.count();
  const authorsEnriched = await prisma.author.count({ where: { enrichedAt: { not: null } } });
  const authorsWithBio = await prisma.author.count({ where: { bio: { not: null } } });
  const authorsWithPhoto = await prisma.author.count({ where: { photoUrl: { not: null } } });

  console.log('=== Database Status ===');
  console.log('Books with coverUrl:', booksWithCover, '/', totalBooks);
  console.log('Authors enriched:', authorsEnriched);
  console.log('Authors with bio:', authorsWithBio);
  console.log('Authors with photo:', authorsWithPhoto);

  // Sample a few books with covers
  const sample = await prisma.book.findMany({
    where: { coverUrl: { not: null } },
    take: 5,
    select: { title: true, coverUrl: true, enrichmentStatus: true, isbn: true }
  });
  console.log('\nSample books with covers:');
  sample.forEach(b => console.log(`  - ${b.title}: ${b.coverUrl?.substring(0, 80)}...`));
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
