/**
 * Check cover status in the library
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const noCover = await prisma.book.count({
    where: { OR: [{ coverUrl: null }, { coverUrl: "" }] }
  });
  
  const googlePlaceholder = await prisma.book.count({
    where: { coverUrl: { contains: "books.google.com/books/content?id=" } }
  });
  
  const total = await prisma.book.count();
  const withGoodCover = total - noCover - googlePlaceholder;
  
  console.log("═══════════════════════════════════════════════════════");
  console.log("                    📚 Cover Status");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`Total books:              ${total}`);
  console.log(`With good covers:         ${withGoodCover}`);
  console.log(`No cover at all:          ${noCover}`);
  console.log(`Google placeholder:       ${googlePlaceholder}`);
  console.log("───────────────────────────────────────────────────────");
  
  // Sample of Google placeholder books
  const googleBooks = await prisma.book.findMany({
    where: { coverUrl: { contains: "books.google.com/books/content?id=" } },
    select: { title: true, isbn: true, authors: { select: { author: { select: { name: true } } } } },
    take: 25,
    orderBy: { title: 'asc' }
  });
  
  if (googleBooks.length > 0) {
    console.log("\n📷 Books with Google placeholder (showing 25):");
    googleBooks.forEach(b => {
      const author = b.authors.map(a => a.author.name).join(', ') || 'Unknown';
      console.log(`  • "${b.title}" by ${author} [${b.isbn || 'no ISBN'}]`);
    });
  }
  
  // Sample of no-cover books
  const noCovers = await prisma.book.findMany({
    where: { OR: [{ coverUrl: null }, { coverUrl: "" }] },
    select: { title: true, isbn: true, authors: { select: { author: { select: { name: true } } } } },
    take: 25,
    orderBy: { title: 'asc' }
  });
  
  if (noCovers.length > 0) {
    console.log("\n❌ Books with no cover (showing 25):");
    noCovers.forEach(b => {
      const author = b.authors.map(a => a.author.name).join(', ') || 'Unknown';
      console.log(`  • "${b.title}" by ${author} [${b.isbn || 'no ISBN'}]`);
    });
  }
  
  await pool.end();
}

main();
