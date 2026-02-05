/**
 * Import Kindle library - matches existing books and sets ownedKindle flag
 * Run with: npx tsx scripts/import-kindle.ts
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
  'clawd/brain/projects/my-library/kindle-library.json'
);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'cherylcarpenter2015@gmail.com';
const MATCH_THRESHOLD = 0.85; // Similarity threshold for fuzzy matching

// CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || Infinity;

interface KindleBook {
  title: string;
  author: string;
  acquired?: string;
  asin?: string | null;
  type?: string;
}

async function main() {
  console.log('📱 Kindle Import');
  console.log(`   Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`   Limit: ${LIMIT === Infinity ? 'None' : LIMIT}`);
  console.log('');

  // Load data
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  const kindleBooks: KindleBook[] = data.books;
  console.log(`📖 Loaded ${kindleBooks.length} Kindle books\n`);

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

  // Load all existing books with their authors for matching
  const existingBooks = await prisma.book.findMany({
    include: {
      authors: { include: { author: true } },
      userBooks: { where: { libraryId: library.id } },
    },
  });
  console.log(`📚 Found ${existingBooks.length} existing books to match against\n`);

  // Build lookup structures
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
  const unmatched: string[] = [];

  // Process Kindle books
  const toProcess = kindleBooks.slice(0, LIMIT);

  for (const kindleBook of toProcess) {
    stats.processed++;

    // Check exclusion
    if (isExcluded(kindleBook.title)) {
      stats.excluded++;
      continue;
    }

    // Parse title (remove series info for matching)
    const { cleanTitle } = parseSeries(kindleBook.title);
    const normalizedTitle = normalizeTitle(cleanTitle);

    // Try exact match first
    let matchedBook = booksByNormalizedTitle.get(normalizedTitle)?.[0];

    // Try fuzzy match if no exact match
    if (!matchedBook) {
      let bestMatch: typeof existingBooks[0] | null = null;
      let bestScore = 0;

      for (const book of existingBooks) {
        const score = similarity(cleanTitle, book.title);
        if (score > bestScore && score >= MATCH_THRESHOLD) {
          // Verify author matches too
          const kindleAuthors = parseAuthors(kindleBook.author);
          const bookAuthors = book.authors.map(a => a.author.name);
          
          const authorMatch = kindleAuthors.some(ka => 
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
      unmatched.push(`${kindleBook.title} by ${kindleBook.author}`);
      continue;
    }

    // Update ownedKindle flag
    if (DRY_RUN) {
      console.log(`   ✅ Would match: "${kindleBook.title}" → "${matchedBook.title}"`);
      stats.updated++;
      continue;
    }

    try {
      // Find or create UserBook
      const userBook = matchedBook.userBooks[0];
      
      if (userBook) {
        await prisma.userBook.update({
          where: { id: userBook.id },
          data: {
            ownedKindle: true,
            kindleAsin: kindleBook.asin || undefined,
          },
        });
      } else {
        // Book exists but not in user's library - add it
        await prisma.userBook.create({
          data: {
            libraryId: library.id,
            bookId: matchedBook.id,
            shelf: 'TO_READ',
            ownedKindle: true,
            kindleAsin: kindleBook.asin || null,
          },
        });
      }

      stats.updated++;
      if (stats.updated % 50 === 0) {
        console.log(`   ✅ Updated ${stats.updated} books...`);
      }

    } catch (error) {
      stats.errors++;
      console.error(`   ❌ Error updating "${kindleBook.title}":`, error);
    }
  }

  // Print summary
  printStats('Kindle Import', stats);

  if (unmatched.length > 0) {
    console.log(`\n📋 Unmatched Kindle books (${unmatched.length}):`);
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
