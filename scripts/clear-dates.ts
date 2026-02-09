import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const csvPath = '/Users/cherylcarpenter/Downloads/goodreads_library_export (2).csv';
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));

  const booksWithNullDate: { bookId: string; title: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let char of line) {
      if (char === '"') inQuotes = !inQuotes;
      else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else current += char;
    }
    values.push(current.trim());
    
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => row[h] = values[idx]);
    
    if (!row['Date Read'] || row['Date Read'] === '') {
      booksWithNullDate.push({
        bookId: row['Book Id'],
        title: row['Title']
      });
    }
  }

  console.log('Books in CSV with null dateRead:', booksWithNullDate.length);

  const library = await prisma.library.findFirst({
    where: { user: { email: 'cherylcarpenter2015@gmail.com' } }
  });

  let cleared = 0;
  for (const b of booksWithNullDate) {
    const book = await prisma.book.findUnique({ where: { goodreadsId: b.bookId } });
    if (book) {
      const userBook = await prisma.userBook.findFirst({
        where: { libraryId: library.id, bookId: book.id }
      });
      if (userBook && userBook.dateRead !== null) {
        await prisma.userBook.update({
          where: { id: userBook.id },
          data: { dateRead: null }
        });
        console.log('Cleared:', b.title.substring(0, 60));
        cleared++;
      }
    }
  }

  console.log('\n✅ Cleared dateRead for', cleared, 'books');
}

main().catch(console.error).finally(() => prisma.$disconnect());
