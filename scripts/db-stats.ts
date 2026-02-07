import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const p = new PrismaClient({ adapter: new PrismaPg(pool) });
(async () => {
  const totalBooks = await p.book.count();
  const booksWithIsbn = await p.book.count({ where: { isbn: { not: null } } });
  const totalAuthors = await p.author.count();
  const authorsWithBio = await p.author.count({ where: { bio: { not: null } } });
  const authorsWithPhoto = await p.author.count({ where: { photoUrl: { not: null } } });
  
  console.log('=== Database Statistics ===');
  console.log(`Books: ${totalBooks} total, ${booksWithIsbn} with ISBN (${Math.round(booksWithIsbn/totalBooks*100)}%)`);
  console.log(`Authors: ${totalAuthors} total, ${authorsWithBio} with bio, ${authorsWithPhoto} with photo`);
  await p.$disconnect();
})();