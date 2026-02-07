import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const total = await prisma.book.count();
  
  const withDesc = await prisma.book.count({ where: { description: { not: null } } });
  const withIsbn = await prisma.book.count({ where: { isbn: { not: null } } });
  const withOlid = await prisma.book.count({ where: { openLibraryId: { not: null } } });
  const withoutBoth = await prisma.book.count({ 
    where: { isbn: null, openLibraryId: null } 
  });
  
  console.log('=== Description Coverage Analysis ===');
  console.log('Total books:', total);
  console.log('With descriptions:', withDesc, '(' + (withDesc/total*100).toFixed(1) + '%)');
  console.log('With ISBN:', withIsbn, '(' + (withIsbn/total*100).toFixed(1) + '%)');
  console.log('With OpenLibrary ID:', withOlid, '(' + (withOlid/total*100).toFixed(1) + '%)');
  console.log('No ISBN AND no OL ID:', withoutBoth, '(' + (withoutBoth/total*100).toFixed(1) + '%)');
  
  // Sample books without descriptions
  const noDesc = await prisma.book.findMany({
    where: { description: null },
    take: 10,
    select: { title: true, isbn: true, openLibraryId: true }
  });
  console.log('\n=== Sample books WITHOUT descriptions ===');
  noDesc.forEach(b => console.log(' -', b.title, '| ISBN:', b.isbn || 'null', '| OLID:', b.openLibraryId || 'null'));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
