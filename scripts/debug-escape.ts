import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL!;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter, log: ['error', 'warn'] });

async function main() {
  const shelf = 'READ';
  
  // Count total
  const total = await prisma.book.count({
    where: {
      userBooks: { some: { shelf } }
    }
  });
  console.log('Total READ books:', total);

  // Fetch books (same as API)
  const books = await prisma.book.findMany({
    where: {
      userBooks: { some: { shelf } }
    },
    include: {
      authors: {
        include: {
          author: { select: { id: true, name: true, slug: true } }
        }
      },
      series: { select: { id: true, name: true, slug: true } },
      genres: {
        include: { genre: { select: { id: true, name: true, slug: true } } },
        take: 3
      },
      userBooks: {
        where: { shelf },
        select: { shelf: true, dateRead: true, dateAdded: true, myRating: true, ownedKindle: true, ownedAudible: true },
        take: 1
      }
    },
    take: 10
  });

  console.log('Books fetched:', books.length);
  
  const escape = books.find(b => b.title === 'Escape!');
  console.log('Escape! found:', !!escape);
  
  if (!escape) {
    console.log('First 5 books:', books.slice(0, 5).map(b => b.title));
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); });
