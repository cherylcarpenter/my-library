import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function mergeDuplicates() {
  const authors = await prisma.author.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      _count: { select: { books: true } }
    }
  });

  // Group by normalized name
  const byName = new Map<string, typeof authors>();
  for (const author of authors) {
    const key = author.name.toLowerCase().trim();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(author);
  }

  const duplicates = [...byName.entries()]
    .filter(([_, authors]) => authors.length > 1);

  console.log(`Processing ${duplicates.length} duplicate groups...\n`);

  let reassigned = 0;
  let removed = 0;
  let deleted = 0;

  for (const [name, authors] of duplicates) {
    // Pick canonical: prefer slug without number suffix, then most books
    const sorted = [...authors].sort((a, b) => {
      const aHasNum = /-\d+$/.test(a.slug);
      const bHasNum = /-\d+$/.test(b.slug);
      if (aHasNum !== bHasNum) return aHasNum ? 1 : -1;
      return b._count.books - a._count.books;
    });

    const canonical = sorted[0];
    const dupes = sorted.slice(1);

    for (const dupe of dupes) {
      // Get all book associations for this duplicate
      const dupeAssocs = await prisma.bookAuthor.findMany({
        where: { authorId: dupe.id },
        select: { bookId: true, role: true }
      });

      for (const assoc of dupeAssocs) {
        // Check if canonical already has this book
        const existing = await prisma.bookAuthor.findFirst({
          where: { bookId: assoc.bookId, authorId: canonical.id }
        });

        if (existing) {
          // Already linked to canonical - just delete the duplicate link
          await prisma.bookAuthor.deleteMany({
            where: { bookId: assoc.bookId, authorId: dupe.id }
          });
          removed++;
        } else {
          // Reassign to canonical
          await prisma.bookAuthor.updateMany({
            where: { bookId: assoc.bookId, authorId: dupe.id },
            data: { authorId: canonical.id }
          });
          reassigned++;
        }
      }

      // Delete the duplicate author
      await prisma.author.delete({ where: { id: dupe.id } });
      deleted++;
    }

    // Progress every 100
    if (deleted % 100 === 0 && deleted > 0) {
      console.log(`  ...processed ${deleted} duplicates`);
    }
  }

  console.log(`\n✅ Reassigned ${reassigned} book-author links`);
  console.log(`✅ Removed ${removed} redundant links`);
  console.log(`✅ Deleted ${deleted} duplicate author records`);

  const remaining = await prisma.author.count();
  console.log(`\nAuthors remaining: ${remaining}`);

  await prisma.$disconnect();
  await pool.end();
}

mergeDuplicates().catch(console.error);
