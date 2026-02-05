/**
 * Import Audible library - matches existing books and sets ownedAudible flag
 * Run with: npx tsx scripts/import-audible.ts
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
  normalizeTitle,
  isExcluded,
  parseSeries,
  parseAuthors,
  similarity,
  slugify,
  makeUniqueSlug,
  createStats,
  printStats,
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
  'clawd/brain/projects/my-library/audible-library.json'
);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'cherylcarpenter2015@gmail.com';
const MATCH_THRESHOLD = 0.85;

// CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || Infinity;

interface AudibleBook {
  title: string;
  author: string;
  acquired?: string;
  asin?: string;
  narrators?: string[];
  series?: string | null;
  seriesOrder?: number | null;
  duration?: string;
  genre?: string;
}

async function main() {
  console.log('🎧 Audible Import');
  console.log(`   Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`   Limit: ${LIMIT === Infinity ? 'None' : LIMIT}`);
  console.log('');

  // Load data
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  const audibleBooks: AudibleBook[] = data.books;
  console.log(`📖 Loaded ${audibleBooks.length} Audible books\n`);

  // Get library
  const user = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!user) {
    console.error('❌ User not found. Run Goodreads import first.');
    process.exit(1);
  }
  
  const library = await prisma.library.findFirst({ where: { userId: user.id } });
  if (!library) {
    console.error('❌ Library not found. Run Goodreads import first.');
    process.exit(1);
  }

  // Load existing data
  const existingBooks = await prisma.book.findMany({
    include: {
      authors: { include: { author: true } },
      userBooks: { where: { libraryId: library.id } },
    },
  });
  console.log(`📚 Found ${existingBooks.length} existing books to match against\n`);

  // Get existing series slugs for creating new series
  const existingSeriesSlugs = new Set<string>();
  (await prisma.series.findMany({ select: { slug: true } })).forEach(s => existingSeriesSlugs.add(s.slug));

  // Build lookup
  const booksByNormalizedTitle = new Map<string, typeof existingBooks[0][]>();
  for (const book of existingBooks) {
    const normalized = normalizeTitle(book.title);
    if (!booksByNormalizedTitle.has(normalized)) {
      booksByNormalizedTitle.set(normalized, []);
    }
    booksByNormalizedTitle.get(normalized)!.push(book);
  }

  // Track stats
  const stats = createStats();
  const seriesStats = createStats();
  const unmatched: string[] = [];

  // Process Audible books
  const toProcess = audibleBooks.slice(0, LIMIT);

  for (const audibleBook of toProcess) {
    stats.processed++;

    // Check exclusion
    if (isExcluded(audibleBook.title)) {
      stats.excluded++;
      continue;
    }

    // Parse title
    const { cleanTitle } = parseSeries(audibleBook.title);
    const normalizedTitle = normalizeTitle(cleanTitle);

    // Try exact match first
    let matchedBook = booksByNormalizedTitle.get(normalizedTitle)?.[0];

    // Try fuzzy match
    if (!matchedBook) {
      let bestMatch: typeof existingBooks[0] | null = null;
      let bestScore = 0;

      for (const book of existingBooks) {
        const score = similarity(cleanTitle, book.title);
        if (score > bestScore && score >= MATCH_THRESHOLD) {
          const audibleAuthors = parseAuthors(audibleBook.author);
          const bookAuthors = book.authors.map(a => a.author.name);
          
          const authorMatch = audibleAuthors.some(ka => 
            bookAuthors.some(ba => similarity(ka, ba) >= MATCH_THRESHOLD)
          );

          if (authorMatch) {
            bestScore = score;
            bestMatch = book;
          }
        }
      }

      matchedBook = bestMatch || undefined;
    }

    if (!matchedBook) {
      stats.skipped++;
      unmatched.push(`${audibleBook.title} by ${audibleBook.author}`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`   ✅ Would match: "${audibleBook.title}" → "${matchedBook.title}"`);
      stats.updated++;
      continue;
    }

    try {
      // Handle series from Audible data
      if (audibleBook.series && !matchedBook.seriesId) {
        const seriesSlug = makeUniqueSlug(slugify(audibleBook.series), existingSeriesSlugs);
        const series = await prisma.series.upsert({
          where: { slug: seriesSlug },
          create: { name: audibleBook.series, slug: seriesSlug },
          update: {},
        });
        
        // Update book with series
        await prisma.book.update({
          where: { id: matchedBook.id },
          data: {
            seriesId: series.id,
            seriesOrder: audibleBook.seriesOrder || null,
          },
        });
        seriesStats.created++;
      }

      // Update/create UserBook with Audible data
      const userBook = matchedBook.userBooks[0];
      const narrators = audibleBook.narrators || [];

      if (userBook) {
        await prisma.userBook.update({
          where: { id: userBook.id },
          data: {
            ownedAudible: true,
            audibleAsin: audibleBook.asin || undefined,
            audibleDuration: audibleBook.duration || undefined,
            audibleNarrators: narrators,
          },
        });
      } else {
        await prisma.userBook.create({
          data: {
            libraryId: library.id,
            bookId: matchedBook.id,
            shelf: 'TO_READ',
            ownedAudible: true,
            audibleAsin: audibleBook.asin || null,
            audibleDuration: audibleBook.duration || null,
            audibleNarrators: narrators,
          },
        });
      }

      stats.updated++;
      if (stats.updated % 50 === 0) {
        console.log(`   ✅ Updated ${stats.updated} books...`);
      }

    } catch (error) {
      stats.errors++;
      console.error(`   ❌ Error updating "${audibleBook.title}":`, error);
    }
  }

  // Print summary
  printStats('Audible Import', stats);
  printStats('Series (from Audible)', seriesStats);

  if (unmatched.length > 0) {
    console.log(`\n📋 Unmatched Audible books (${unmatched.length}):`);
    unmatched.slice(0, 20).forEach(t => console.log(`   - ${t}`));
    if (unmatched.length > 20) {
      console.log(`   ... and ${unmatched.length - 20} more`);
    }
  }

  await prisma.$disconnect();
  console.log('\n✨ Done!');
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
