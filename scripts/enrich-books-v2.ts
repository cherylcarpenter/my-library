/**
 * Enrich books with OpenLibrary data - V2
 * 
 * Improvements over v1:
 * - Extracts cover_i from search results for books without ISBN
 * - Uses OpenLibrary cover ID API: covers.openlibrary.org/b/id/{cover_id}-L.jpg
 * - Re-processes ENRICHED books that are missing covers
 * - Better logging and progress tracking
 *
 * Usage:
 *   npx tsx scripts/enrich-books-v2.ts                    # Process books missing covers
 *   npx tsx scripts/enrich-books-v2.ts --dry              # Dry run
 *   npx tsx scripts/enrich-books-v2.ts --limit 50         # Limit to 50 books
 *   npx tsx scripts/enrich-books-v2.ts --reprocess        # Re-try NOT_FOUND books
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter, log: ['error'] });

const RATE_LIMIT_MS = 600;
let lastRequestTime = 0;

interface Options {
  dryRun?: boolean;
  limit?: number;
  reprocess?: boolean;
}

async function rateLimitedFetch(url: string): Promise<any> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;

  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }

  lastRequestTime = Date.now();
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Search by ISBN - returns full book data including covers array
 */
async function searchByISBN(isbn: string): Promise<any | null> {
  if (!isbn) return null;

  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;

  try {
    const data = await rateLimitedFetch(url);
    const result = data[`ISBN:${isbn}`];
    if (result) {
      // Add source for tracking
      result._source = 'isbn';
      result._isbn = isbn;
    }
    return result || null;
  } catch (error) {
    console.error(`  Error fetching ISBN ${isbn}:`, error);
    return null;
  }
}

/**
 * Search by title and author - extracts cover_i for cover URL
 */
async function searchByTitleAuthor(title: string, author?: string): Promise<any | null> {
  const encodedTitle = encodeURIComponent(title.replace(/[^\w\s]/g, '').trim());
  const encodedAuthor = author ? encodeURIComponent(author.replace(/[^\w\s]/g, '').trim()) : '';
  const authorParam = encodedAuthor ? `&author=${encodedAuthor}` : '';

  const url = `https://openlibrary.org/search.json?title=${encodedTitle}${authorParam}&limit=3`;

  try {
    const data = await rateLimitedFetch(url);
    
    if (!data.docs || data.docs.length === 0) return null;

    // Try to find best match - prefer one with cover
    let bestMatch = data.docs[0];
    for (const doc of data.docs) {
      if (doc.cover_i) {
        bestMatch = doc;
        break;
      }
    }

    bestMatch._source = 'search';
    return bestMatch;
  } catch (error) {
    console.error(`  Error searching "${title}":`, error);
    return null;
  }
}

/**
 * Extract cover URL from OpenLibrary data
 * IMPORTANT: Only return a URL if we know a cover exists
 */
function extractCoverUrl(data: any, isbn?: string): string | null {
  if (!data) return null;

  // Method 1: From cover_i in search results (verified cover exists)
  if (data.cover_i) {
    return `https://covers.openlibrary.org/b/id/${data.cover_i}-L.jpg`;
  }

  // Method 2: From covers array in books API (verified cover exists)
  if (data.cover && data.cover.large) {
    return data.cover.large;
  }

  // Method 3: From edition cover_id (verified cover exists)
  if (data.cover_edition_key) {
    return `https://covers.openlibrary.org/b/olid/${data.cover_edition_key}-L.jpg`;
  }

  // Method 4: ISBN URL - ONLY if API returned cover data for this ISBN
  // We can tell by checking if the result has any cover-related fields
  // If no cover data was returned, don't generate ISBN URL (it will be 1x1)
  if (isbn && (data.cover_i || data.cover || data.cover_edition_key)) {
    return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
  }

  return null;
}

/**
 * Extract description from various formats
 */
function extractDescription(data: any): string | null {
  if (!data) return null;

  // Search API uses first_sentence
  if (data.first_sentence && Array.isArray(data.first_sentence)) {
    return data.first_sentence[0];
  }

  // Books API uses description
  if (data.description) {
    if (typeof data.description === 'string') {
      return data.description.trim();
    }
    if (data.description.value) {
      return data.description.value.trim();
    }
  }

  return null;
}

/**
 * Extract OpenLibrary ID
 */
function extractOpenLibraryId(data: any): string | null {
  if (!data) return null;

  // From books API
  if (data.key && data.key.includes('/works/')) {
    return data.key.replace('/works/', '');
  }

  // From search API
  if (data.key && data.key.includes('/works/')) {
    return data.key.replace('/works/', '');
  }

  // Direct work key from search
  if (data.edition_key && data.edition_key.length > 0) {
    return data.edition_key[0];
  }

  return null;
}

async function enrichBooks(options: Options = {}) {
  const { dryRun = false, limit, reprocess = false } = options;

  console.log(`📚 Book Enrichment V2`);
  console.log(`   Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`   Reprocess NOT_FOUND: ${reprocess}`);

  // Target books missing covers (regardless of enrichment status)
  const whereClause: any = {
    coverUrl: null,
  };

  // Optionally skip NOT_FOUND unless reprocessing
  if (!reprocess) {
    whereClause.enrichmentStatus = { not: 'NOT_FOUND' };
  }

  const totalPending = await prisma.book.count({ where: whereClause });
  console.log(`   Books missing covers: ${totalPending}`);

  if (totalPending === 0) {
    console.log('✅ All books have covers!');
    return;
  }

  const take = limit || totalPending;
  let processed = 0;
  let foundCovers = 0;
  let foundDescriptions = 0;
  let notFound = 0;
  let failed = 0;

  const books = await prisma.book.findMany({
    where: whereClause,
    take,
    include: {
      authors: {
        include: { author: true },
        take: 1,
      },
    },
    orderBy: { title: 'asc' },
  });

  for (const book of books) {
    processed++;
    const authorName = book.authors[0]?.author?.name;
    const progress = Math.round((processed / books.length) * 100);

    console.log(`\n[${processed}/${books.length}] ${book.title.substring(0, 50)}${book.title.length > 50 ? '...' : ''}`);
    console.log(`   Author: ${authorName || 'Unknown'} | ISBN: ${book.isbn || 'none'} | Status: ${book.enrichmentStatus}`);

    try {
      let olData = null;
      let coverUrl: string | null = null;
      let description: string | null = null;
      let openLibraryId: string | null = null;

      // Strategy 1: Try ISBN lookup first (best cover quality)
      if (book.isbn) {
        olData = await searchByISBN(book.isbn);
        if (olData) {
          coverUrl = extractCoverUrl(olData, book.isbn);
          description = extractDescription(olData);
          openLibraryId = extractOpenLibraryId(olData);
          console.log(`   → ISBN lookup: ${coverUrl ? '✓ cover' : '✗ no cover'}`);
        }
      }

      // Strategy 2: Title+Author search (gets cover_i)
      if (!coverUrl) {
        olData = await searchByTitleAuthor(book.title, authorName);
        if (olData) {
          coverUrl = extractCoverUrl(olData);
          description = description || extractDescription(olData);
          openLibraryId = openLibraryId || extractOpenLibraryId(olData);
          console.log(`   → Title search: ${coverUrl ? '✓ cover' : '✗ no cover'}`);
        }
      }

      // Strategy 3: Title-only search (last resort)
      if (!coverUrl && authorName) {
        olData = await searchByTitleAuthor(book.title);
        if (olData) {
          coverUrl = extractCoverUrl(olData);
          description = description || extractDescription(olData);
          console.log(`   → Title-only search: ${coverUrl ? '✓ cover' : '✗ no cover'}`);
        }
      }

      if (coverUrl || description || openLibraryId) {
        const updates: any = {
          enrichedAt: new Date(),
          enrichmentStatus: coverUrl ? 'ENRICHED' : 'PARTIAL',
        };

        if (coverUrl && !book.coverUrl) {
          updates.coverUrl = coverUrl;
          foundCovers++;
        }
        if (description && !book.description) {
          updates.description = description;
          foundDescriptions++;
        }
        if (openLibraryId && !book.openLibraryId) {
          updates.openLibraryId = openLibraryId;
        }

        if (!dryRun) {
          await prisma.book.update({
            where: { id: book.id },
            data: updates,
          });
        }

        console.log(`   ✓ Updated: cover=${!!coverUrl}, desc=${!!description}`);
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
      failed++;
      console.error(`   ! Error:`, error instanceof Error ? error.message : 'Unknown');
      
      if (!dryRun) {
        await prisma.book.update({
          where: { id: book.id },
          data: {
            enrichedAt: new Date(),
            enrichmentStatus: 'FAILED',
          },
        });
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 Summary:');
  console.log(`   Processed: ${processed}`);
  console.log(`   Found covers: ${foundCovers}`);
  console.log(`   Found descriptions: ${foundDescriptions}`);
  console.log(`   Not found: ${notFound}`);
  console.log(`   Failed: ${failed}`);
  console.log('='.repeat(60));

  if (dryRun) {
    console.log('\n⚠️  Dry run - no changes made. Run without --dry to apply.');
  } else {
    console.log('\n✅ Enrichment complete!');
  }
}

// Parse args
const args = process.argv.slice(2);
const options: Options = {
  dryRun: args.includes('--dry') || args.includes('-d'),
  reprocess: args.includes('--reprocess') || args.includes('-r'),
  limit: args.includes('--limit')
    ? parseInt(args[args.indexOf('--limit') + 1], 10)
    : undefined,
};

enrichBooks(options)
  .catch(console.error)
  .finally(() => process.exit(0));
