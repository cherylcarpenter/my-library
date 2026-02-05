/**
 * Import books from Goodreads JSON export
 * Run with: npx tsx scripts/import-goodreads.ts
 * 
 * Options:
 *   --dry-run    Preview without writing to database
 *   --limit=N    Only process first N books
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  slugify,
  normalizeTitle,
  isExcluded,
  parseSeries,
  parseAuthors,
  mapShelf,
  normalizeIsbn,
  makeUniqueSlug,
  createStats,
  printStats,
  type ImportStats,
} from './utils';

// Initialize Prisma with pg adapter
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Config
const DATA_PATH = join(
  process.env.HOME || '',
  'clawd/brain/projects/my-library/goodreads-library.json'
);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'cherylcarpenter2015@gmail.com';

// CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || Infinity;

interface GoodreadsBook {
  title: string;
  author: string;
  authorLastFirst?: string;
  additionalAuthors?: string | null;
  isbn?: string | null;
  isbn13?: string | null;
  bookId?: string;
  myRating?: number;
  averageRating?: number;
  publisher?: string;
  binding?: string;
  pages?: number;
  yearPublished?: number;
  originalPublicationYear?: number;
  dateRead?: string | null;
  acquired?: string;
  bookshelves?: string[];
  exclusiveShelf?: string;
  myReview?: string | null;
  privateNotes?: string | null;
  readCount?: number;
}

async function main() {
  console.log('📚 Goodreads Import');
  console.log(`   Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`   Limit: ${LIMIT === Infinity ? 'None' : LIMIT}`);
  console.log('');

  // Load data
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  const books: GoodreadsBook[] = data.books;
  console.log(`📖 Loaded ${books.length} books from Goodreads\n`);

  // Get or create user and library
  let user = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!user) {
    if (DRY_RUN) {
      console.log(`👤 Would create user: ${ADMIN_EMAIL}`);
    } else {
      user = await prisma.user.create({
        data: { email: ADMIN_EMAIL, role: 'ADMIN' },
      });
      console.log(`👤 Created user: ${ADMIN_EMAIL}`);
    }
  }

  let library = user ? await prisma.library.findFirst({ where: { userId: user.id } }) : null;
  if (!library && user) {
    if (DRY_RUN) {
      console.log(`📚 Would create library for user`);
    } else {
      library = await prisma.library.create({
        data: {
          name: "Cheryl's Library",
          slug: 'cheryls-library',
          userId: user.id,
          isPublic: true,
        },
      });
      console.log(`📚 Created library: ${library.name}`);
    }
  }

  // Track stats
  const bookStats = createStats();
  const authorStats = createStats();
  const seriesStats = createStats();

  // Track existing slugs for uniqueness
  const existingBookSlugs = new Set<string>();
  const existingAuthorSlugs = new Set<string>();
  const existingSeriesSlugs = new Set<string>();

  // Preload existing slugs
  if (!DRY_RUN) {
    (await prisma.book.findMany({ select: { slug: true } })).forEach(b => existingBookSlugs.add(b.slug));
    (await prisma.author.findMany({ select: { slug: true } })).forEach(a => existingAuthorSlugs.add(a.slug));
    (await prisma.series.findMany({ select: { slug: true } })).forEach(s => existingSeriesSlugs.add(s.slug));
  }

  // Process books
  const toProcess = books.slice(0, LIMIT);
  
  for (const grBook of toProcess) {
    bookStats.processed++;

    // Check exclusion
    if (isExcluded(grBook.title)) {
      bookStats.excluded++;
      console.log(`   ⛔ Excluded: ${grBook.title}`);
      continue;
    }

    try {
      // Parse series from title
      const { cleanTitle, seriesName, seriesOrder } = parseSeries(grBook.title);

      // Parse authors
      const authorNames = parseAuthors(grBook.author, grBook.additionalAuthors);
      if (authorNames.length === 0) {
        console.log(`   ⚠️  No author for: ${grBook.title}`);
        bookStats.skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`   📖 Would import: "${cleanTitle}" by ${authorNames.join(', ')}`);
        if (seriesName) console.log(`      Series: ${seriesName} #${seriesOrder}`);
        bookStats.created++;
        continue;
      }

      // Create/get series
      let seriesId: string | null = null;
      if (seriesName) {
        const seriesSlug = makeUniqueSlug(slugify(seriesName), existingSeriesSlugs);
        const series = await prisma.series.upsert({
          where: { slug: seriesSlug },
          create: { name: seriesName, slug: seriesSlug },
          update: {},
        });
        seriesId = series.id;
        seriesStats.created++;
      }

      // Create/get authors
      const authorIds: string[] = [];
      for (const authorName of authorNames) {
        const authorSlug = makeUniqueSlug(slugify(authorName), existingAuthorSlugs);
        const author = await prisma.author.upsert({
          where: { slug: authorSlug },
          create: { name: authorName, slug: authorSlug },
          update: {},
        });
        authorIds.push(author.id);
        authorStats.created++;
      }

      // Create or find book - check by goodreadsId first, then by slug
      const isbn = normalizeIsbn(grBook.isbn);
      const isbn13 = normalizeIsbn(grBook.isbn13);
      
      let book = grBook.bookId 
        ? await prisma.book.findUnique({ where: { goodreadsId: grBook.bookId } })
        : null;

      if (book) {
        // Book exists, update it
        book = await prisma.book.update({
          where: { id: book.id },
          data: {
            pages: grBook.pages || undefined,
            averageRating: grBook.averageRating || undefined,
            seriesId: seriesId || undefined,
            seriesOrder: seriesOrder || undefined,
          },
        });
        bookStats.updated++;
      } else {
        // Create new book
        const bookSlug = makeUniqueSlug(slugify(cleanTitle), existingBookSlugs);
        book = await prisma.book.create({
          data: {
            title: cleanTitle,
            slug: bookSlug,
            isbn,
            isbn13,
            goodreadsId: grBook.bookId || null,
            pages: grBook.pages || null,
            yearPublished: grBook.yearPublished || null,
            originalPublicationYear: grBook.originalPublicationYear || null,
            publisher: grBook.publisher || null,
            binding: grBook.binding || null,
            averageRating: grBook.averageRating || null,
            seriesId,
            seriesOrder: seriesOrder,
          },
        });
        bookStats.created++;
      }

      // Link authors
      for (const authorId of authorIds) {
        await prisma.bookAuthor.upsert({
          where: {
            bookId_authorId_role: { bookId: book.id, authorId, role: 'author' },
          },
          create: { bookId: book.id, authorId, role: 'author' },
          update: {},
        });
      }

      // Create UserBook entry
      if (library) {
        const shelf = mapShelf(grBook.exclusiveShelf || 'to-read');
        const dateRead = grBook.dateRead ? new Date(grBook.dateRead) : null;
        const dateAdded = grBook.acquired ? new Date(grBook.acquired) : new Date();

        await prisma.userBook.upsert({
          where: {
            libraryId_bookId: { libraryId: library.id, bookId: book.id },
          },
          create: {
            libraryId: library.id,
            bookId: book.id,
            shelf,
            dateRead,
            dateAdded,
            myRating: grBook.myRating && grBook.myRating > 0 ? grBook.myRating : null,
            myReview: grBook.myReview || null,
            privateNotes: grBook.privateNotes || null,
            readCount: grBook.readCount || 0,
          },
          update: {
            shelf,
            dateRead,
            myRating: grBook.myRating && grBook.myRating > 0 ? grBook.myRating : undefined,
            myReview: grBook.myReview || undefined,
            readCount: grBook.readCount || undefined,
          },
        });
      }

      const totalDone = bookStats.created + bookStats.updated;
      if (totalDone % 100 === 0) {
        console.log(`   ✅ Processed ${totalDone} books...`);
      }

    } catch (error) {
      bookStats.errors++;
      console.error(`   ❌ Error importing "${grBook.title}":`, error);
    }
  }

  // Print summary
  printStats('Books', bookStats);
  printStats('Authors', authorStats);
  printStats('Series', seriesStats);

  await prisma.$disconnect();
  console.log('\n✨ Done!');
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
