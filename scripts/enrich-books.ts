/**
 * Enrich books with OpenLibrary data
 * Fetches cover images, descriptions, and OpenLibrary IDs
 *
 * Usage:
 *   npx tsx scripts/enrich-books.ts           # Process all pending books
 *   npx tsx scripts/enrich-books.ts --dry     # Dry run (no database writes)
 *   npx tsx scripts/enrich-books.ts --limit 100  # Process only 100 books
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  searchByISBN,
  searchByTitleAuthor,
  getCoverUrl,
  extractDescription,
  extractOpenLibraryId,
} from '../src/lib/openlibrary';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log: ['error'],
  });
}

const prisma = globalForPrisma.prisma ?? createPrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

interface Options {
  dryRun?: boolean;
  limit?: number;
}

async function enrichBooks(options: Options = {}) {
  const { dryRun = false, limit } = options;

  console.log(`🔍 Enriching books from OpenLibrary...`);
  console.log(`   Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);

  // Build query for pending books
  const whereClause: any = {
    enrichmentStatus: 'PENDING',
  };

  // Get total count first
  const totalPending = await prisma.book.count({ where: whereClause });
  console.log(`   Total pending: ${totalPending}`);

  if (totalPending === 0) {
    console.log('✅ No books to enrich');
    return;
  }

  // Fetch books in batches
  const take = limit || 100;
  let processed = 0;
  let enriched = 0;
  let notFound = 0;
  let failed = 0;
  let skipped = 0;

  while (true) {
    const books = await prisma.book.findMany({
      where: whereClause,
      take,
      skip: processed,
      include: {
        authors: {
          include: {
            author: true,
          },
        },
      },
    });

    if (books.length === 0) break;

    for (const book of books) {
      processed++;
      const authorName = book.authors[0]?.author?.name;

      console.log(`\n[${processed}/${totalPending}] ${book.title}${authorName ? ` by ${authorName}` : ''}`);

      try {
        let olData = null;

        // Try ISBN first (primary method)
        if (book.isbn) {
          olData = await searchByISBN(book.isbn);
        }

        // Fallback to title + author search
        if (!olData) {
          olData = await searchByTitleAuthor(book.title, authorName);
        }

        if (olData) {
          const description = extractDescription(olData.description);
          const openLibraryId = extractOpenLibraryId(olData);
          const coverUrl = book.isbn ? getCoverUrl(book.isbn, 'L') : null;

          const updates: any = {
            enrichedAt: new Date(),
          };

          // Determine enrichment status
          if (description || coverUrl || openLibraryId) {
            updates.enrichmentStatus = 'ENRICHED';
          } else {
            updates.enrichmentStatus = 'PARTIAL';
          }

          // Only update if we have data
          if (openLibraryId) updates.openLibraryId = openLibraryId;
          if (description) updates.description = description;
          if (coverUrl) updates.coverUrl = coverUrl;

          if (!dryRun) {
            await prisma.book.update({
              where: { id: book.id },
              data: updates,
            });
          }

          enriched++;
          console.log(`   ✓ Enriched: OLID=${openLibraryId || '?'}, desc=${description ? 'yes' : 'no'}, cover=${coverUrl ? 'yes' : 'no'}`);
        } else {
          if (!dryRun) {
            await prisma.book.update({
              where: { id: book.id },
              data: {
                enrichedAt: new Date(),
                enrichmentStatus: 'NOT_FOUND',
              },
            });
          }
          notFound++;
          console.log(`   ✗ Not found in OpenLibrary`);
        }
      } catch (error) {
        if (!dryRun) {
          await prisma.book.update({
            where: { id: book.id },
            data: {
              enrichedAt: new Date(),
              enrichmentStatus: 'FAILED',
            },
          });
        }
        failed++;
        console.error(`   ! Error:`, error instanceof Error ? error.message : 'Unknown error');
      }

      // Progress percentage
      const pct = Math.round((processed / Math.min(totalPending, limit || totalPending)) * 100);
      process.stdout.write(`   Progress: ${pct}%\r`);
    }

    // Stop if we hit the limit
    if (limit && processed >= limit) break;
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 Summary:');
  console.log(`   Processed: ${processed}`);
  console.log(`   Enriched: ${enriched}`);
  console.log(`   Not Found: ${notFound}`);
  console.log(`   Failed: ${failed}`);
  console.log('='.repeat(50));

  if (dryRun) {
    console.log('\n⚠️  This was a dry run. Run without --dry to apply changes.');
  } else {
    console.log('\n✅ Enrichment complete!');
  }
}

// Parse command line args
const args = process.argv.slice(2);
const options: Options = {
  dryRun: args.includes('--dry') || args.includes('-d'),
  limit: args.includes('--limit')
    ? parseInt(args[args.indexOf('--limit') + 1], 10)
    : undefined,
};

enrichBooks(options).catch(console.error);
