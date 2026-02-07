/**
 * Cover Enrichment V3 - Improved cover quality
 * 
 * Improvements:
 * - OpenLibrary first (better community-curated covers), Google Books fallback
 * - Downloads and validates images before saving (size + dimensions)
 * - Detects and replaces "bad" covers (too small, wrong aspect ratio)
 * - Handles books without ISBN via title+author search
 * - Batch processing with progress tracking
 * 
 * Usage:
 *   npx tsx scripts/enrich-covers-v3.ts                     # Process books missing/bad covers
 *   npx tsx scripts/enrich-covers-v3.ts --dry               # Dry run
 *   npx tsx scripts/enrich-covers-v3.ts --limit 50          # Limit to 50 books
 *   npx tsx scripts/enrich-covers-v3.ts --replace-bad       # Replace existing bad covers
 *   npx tsx scripts/enrich-covers-v3.ts --all               # Re-process ALL books
 *   npx tsx scripts/enrich-covers-v3.ts --offset 100        # Start from offset (for batching)
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter, log: ['error'] });

// Rate limiting
const OL_RATE_LIMIT_MS = 600;
const GB_RATE_LIMIT_MS = 100;
let lastOLRequest = 0;
let lastGBRequest = 0;

// Validation thresholds
const MIN_FILE_SIZE_BYTES = 15000;      // 15KB minimum (real covers are 30KB+)
const MIN_ASPECT_RATIO = 1.2;            // Height/Width minimum (portrait orientation)
const MAX_ASPECT_RATIO = 2.0;            // Height/Width maximum (not too tall/narrow)
const MIN_WIDTH = 150;                   // Minimum pixel width
const MIN_HEIGHT = 200;                  // Minimum pixel height

interface CoverResult {
  url: string;
  source: 'openlibrary' | 'google';
  fileSize: number;
  width: number;
  height: number;
  aspectRatio: number;
}

interface Options {
  dryRun: boolean;
  limit?: number;
  offset: number;
  replaceBad: boolean;
  all: boolean;
}

interface Stats {
  processed: number;
  foundCovers: number;
  replacedBad: number;
  notFound: number;
  failed: number;
  olSuccess: number;
  gbSuccess: number;
}

/**
 * Rate-limited fetch for OpenLibrary
 */
async function olFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastOLRequest;
  if (elapsed < OL_RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, OL_RATE_LIMIT_MS - elapsed));
  }
  lastOLRequest = Date.now();
  return fetch(url);
}

/**
 * Rate-limited fetch for Google Books
 */
async function gbFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastGBRequest;
  if (elapsed < GB_RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, GB_RATE_LIMIT_MS - elapsed));
  }
  lastGBRequest = Date.now();
  return fetch(url);
}

/**
 * Download image and extract metadata (size, dimensions)
 */
async function validateCoverUrl(url: string): Promise<{ valid: boolean; fileSize: number; width: number; height: number } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    const fileSize = buffer.byteLength;

    // Check minimum file size
    if (fileSize < MIN_FILE_SIZE_BYTES) {
      return { valid: false, fileSize, width: 0, height: 0 };
    }

    // Parse image dimensions from binary data
    const bytes = new Uint8Array(buffer);
    let width = 0;
    let height = 0;

    // JPEG detection (starts with FF D8)
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
      // Find SOF0 marker (FF C0) for dimensions
      for (let i = 2; i < bytes.length - 8; i++) {
        if (bytes[i] === 0xFF && (bytes[i + 1] === 0xC0 || bytes[i + 1] === 0xC2)) {
          height = (bytes[i + 5] << 8) | bytes[i + 6];
          width = (bytes[i + 7] << 8) | bytes[i + 8];
          break;
        }
      }
    }
    // PNG detection (89 50 4E 47)
    else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      // IHDR chunk contains dimensions at bytes 16-23
      width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
      height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    }
    // GIF detection (47 49 46)
    else if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      width = bytes[6] | (bytes[7] << 8);
      height = bytes[8] | (bytes[9] << 8);
    }

    if (width === 0 || height === 0) {
      // Couldn't parse dimensions, but file size is OK
      return { valid: fileSize >= MIN_FILE_SIZE_BYTES, fileSize, width: 0, height: 0 };
    }

    const aspectRatio = height / width;
    const valid = 
      fileSize >= MIN_FILE_SIZE_BYTES &&
      width >= MIN_WIDTH &&
      height >= MIN_HEIGHT &&
      aspectRatio >= MIN_ASPECT_RATIO &&
      aspectRatio <= MAX_ASPECT_RATIO;

    return { valid, fileSize, width, height };
  } catch {
    return null;
  }
}

/**
 * Check if existing cover URL is "bad" (too small, wrong dimensions)
 */
async function isExistingCoverBad(coverUrl: string | null): Promise<boolean> {
  if (!coverUrl) return true;

  const result = await validateCoverUrl(coverUrl);
  if (!result) return true;

  return !result.valid;
}

/**
 * Search OpenLibrary and get best cover
 */
async function getOpenLibraryCover(
  title: string,
  author: string | undefined,
  isbn: string | null
): Promise<CoverResult | null> {
  const candidates: string[] = [];

  // Method 1: ISBN-based cover (if we have ISBN)
  if (isbn) {
    candidates.push(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`);
  }

  // Method 2: Search for cover_i
  try {
    const encodedTitle = encodeURIComponent(title.replace(/[^\w\s]/g, '').trim());
    const encodedAuthor = author ? encodeURIComponent(author.replace(/[^\w\s]/g, '').trim()) : '';
    const authorParam = encodedAuthor ? `&author=${encodedAuthor}` : '';
    
    const searchUrl = `https://openlibrary.org/search.json?title=${encodedTitle}${authorParam}&limit=5`;
    const response = await olFetch(searchUrl);
    
    if (response.ok) {
      const data = await response.json();
      const docs = data.docs || [];
      
      // Collect all cover_i values from search results
      for (const doc of docs) {
        if (doc.cover_i) {
          candidates.push(`https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`);
        }
        if (doc.cover_edition_key) {
          candidates.push(`https://covers.openlibrary.org/b/olid/${doc.cover_edition_key}-L.jpg`);
        }
      }
    }
  } catch (error) {
    console.error(`  [OL] Search error: ${error instanceof Error ? error.message : 'Unknown'}`);
  }

  // Try each candidate and return first valid one
  for (const url of candidates) {
    const validation = await validateCoverUrl(url);
    if (validation?.valid) {
      return {
        url,
        source: 'openlibrary',
        fileSize: validation.fileSize,
        width: validation.width,
        height: validation.height,
        aspectRatio: validation.height / validation.width,
      };
    }
  }

  return null;
}

/**
 * Search Google Books and get cover
 */
async function getGoogleBooksCover(
  title: string,
  author: string | undefined,
  isbn: string | null
): Promise<CoverResult | null> {
  try {
    let searchUrl: string;
    
    if (isbn) {
      searchUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`;
    } else {
      const query = encodeURIComponent(`${title}${author ? ` inauthor:${author}` : ''}`);
      searchUrl = `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=3`;
    }

    const response = await gbFetch(searchUrl);
    if (!response.ok) {
      if (response.status === 429) {
        console.error(`  [GB] Rate limited (quota exceeded)`);
      }
      return null;
    }

    const data = await response.json();
    const items = data.items || [];

    for (const item of items) {
      const imageLinks = item.volumeInfo?.imageLinks;
      if (!imageLinks) continue;

      // Try different image sizes (prefer larger)
      const thumbnailUrl = imageLinks.thumbnail || imageLinks.smallThumbnail;
      if (!thumbnailUrl) continue;

      // Google Books URL manipulation for better quality
      // - Remove zoom parameter or set to higher value
      // - Use https
      const coverUrl = thumbnailUrl
        .replace('http://', 'https://')
        .replace('zoom=1', 'zoom=2')
        .replace('&edge=curl', ''); // Remove curl effect

      const validation = await validateCoverUrl(coverUrl);
      if (validation?.valid) {
        return {
          url: coverUrl,
          source: 'google',
          fileSize: validation.fileSize,
          width: validation.width,
          height: validation.height,
          aspectRatio: validation.height / validation.width,
        };
      }
    }

    return null;
  } catch (error) {
    console.error(`  [GB] Error: ${error instanceof Error ? error.message : 'Unknown'}`);
    return null;
  }
}

/**
 * Get best cover from all sources
 */
async function getBestCover(
  title: string,
  author: string | undefined,
  isbn: string | null
): Promise<CoverResult | null> {
  // Try OpenLibrary first (better community-curated covers)
  console.log(`  → Trying OpenLibrary...`);
  const olCover = await getOpenLibraryCover(title, author, isbn);
  if (olCover) {
    console.log(`    ✓ Found: ${olCover.fileSize} bytes, ${olCover.width}x${olCover.height}`);
    return olCover;
  }
  console.log(`    ✗ No valid cover`);

  // Fall back to Google Books
  console.log(`  → Trying Google Books...`);
  const gbCover = await getGoogleBooksCover(title, author, isbn);
  if (gbCover) {
    console.log(`    ✓ Found: ${gbCover.fileSize} bytes, ${gbCover.width}x${gbCover.height}`);
    return gbCover;
  }
  console.log(`    ✗ No valid cover`);

  return null;
}

async function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  const options: Options = {
    dryRun: args.includes('--dry') || args.includes('-d'),
    limit: args.includes('--limit') 
      ? parseInt(args[args.indexOf('--limit') + 1], 10) 
      : undefined,
    offset: args.includes('--offset')
      ? parseInt(args[args.indexOf('--offset') + 1], 10)
      : 0,
    replaceBad: args.includes('--replace-bad') || args.includes('-r'),
    all: args.includes('--all') || args.includes('-a'),
  };

  console.log('═'.repeat(60));
  console.log('📚 Cover Enrichment V3 - Improved Quality');
  console.log('═'.repeat(60));
  console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Replace bad covers: ${options.replaceBad}`);
  console.log(`Process all: ${options.all}`);
  console.log(`Offset: ${options.offset}`);
  console.log(`Limit: ${options.limit || 'none'}`);
  console.log('─'.repeat(60));

  // Build query based on options
  let whereClause: any = {};
  
  if (options.all) {
    // Process everything
    whereClause = {};
  } else if (options.replaceBad) {
    // Books with covers (we'll validate them) or without
    whereClause = {};
  } else {
    // Only books without covers
    whereClause = { coverUrl: null };
  }

  const totalCount = await prisma.book.count({ where: whereClause });
  console.log(`Total matching books: ${totalCount}`);

  const books = await prisma.book.findMany({
    where: whereClause,
    include: {
      authors: {
        include: { author: true },
        take: 1,
      },
    },
    orderBy: { id: 'asc' },
    skip: options.offset,
    take: options.limit,
  });

  console.log(`Processing batch: ${books.length} books (offset ${options.offset})`);
  console.log('═'.repeat(60));

  const stats: Stats = {
    processed: 0,
    foundCovers: 0,
    replacedBad: 0,
    notFound: 0,
    failed: 0,
    olSuccess: 0,
    gbSuccess: 0,
  };

  for (const book of books) {
    stats.processed++;
    const authorName = book.authors[0]?.author?.name;
    const isbn = book.isbn || book.isbn13;
    const progress = `[${stats.processed}/${books.length}]`;

    console.log(`\n${progress} ${book.title.substring(0, 50)}${book.title.length > 50 ? '...' : ''}`);
    console.log(`  Author: ${authorName || 'Unknown'} | ISBN: ${isbn || 'none'}`);
    console.log(`  Current cover: ${book.coverUrl ? 'yes' : 'none'}`);

    try {
      // Check if existing cover is bad
      let needsNewCover = !book.coverUrl;
      
      if (book.coverUrl && (options.replaceBad || options.all)) {
        const isBad = await isExistingCoverBad(book.coverUrl);
        if (isBad) {
          console.log(`  ⚠ Existing cover is BAD (too small or wrong dimensions)`);
          needsNewCover = true;
        } else {
          console.log(`  ✓ Existing cover is OK, skipping`);
          continue;
        }
      }

      if (!needsNewCover) {
        continue;
      }

      // Find best cover
      const cover = await getBestCover(book.title, authorName, isbn);

      if (cover) {
        if (!options.dryRun) {
          await prisma.book.update({
            where: { id: book.id },
            data: {
              coverUrl: cover.url,
              enrichedAt: new Date(),
              enrichmentStatus: 'ENRICHED',
            },
          });
        }

        stats.foundCovers++;
        if (book.coverUrl) stats.replacedBad++;
        if (cover.source === 'openlibrary') stats.olSuccess++;
        if (cover.source === 'google') stats.gbSuccess++;

        console.log(`  ✓ ${book.coverUrl ? 'REPLACED' : 'SAVED'}: [${cover.source}] ${cover.fileSize} bytes`);
      } else {
        if (!options.dryRun) {
          await prisma.book.update({
            where: { id: book.id },
            data: {
              enrichedAt: new Date(),
              enrichmentStatus: book.coverUrl ? book.enrichmentStatus : 'NOT_FOUND',
            },
          });
        }
        stats.notFound++;
        console.log(`  ✗ No valid cover found`);
      }
    } catch (error) {
      stats.failed++;
      console.error(`  ! Error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('📊 Summary');
  console.log('═'.repeat(60));
  console.log(`Processed:        ${stats.processed}`);
  console.log(`Found covers:     ${stats.foundCovers}`);
  console.log(`  - OpenLibrary:  ${stats.olSuccess}`);
  console.log(`  - Google Books: ${stats.gbSuccess}`);
  console.log(`Replaced bad:     ${stats.replacedBad}`);
  console.log(`Not found:        ${stats.notFound}`);
  console.log(`Failed:           ${stats.failed}`);
  console.log('─'.repeat(60));

  // Output next batch info if applicable
  const nextOffset = options.offset + books.length;
  if (nextOffset < totalCount) {
    console.log(`\n📌 Next batch: --offset ${nextOffset}`);
    console.log(`   Remaining: ${totalCount - nextOffset} books`);
  } else {
    console.log(`\n✅ All books processed!`);
  }

  if (options.dryRun) {
    console.log('\n⚠️  DRY RUN - No changes made');
  }

  // Return stats for programmatic use
  return {
    ...stats,
    nextOffset: nextOffset < totalCount ? nextOffset : null,
    totalCount,
  };
}

main()
  .catch(console.error)
  .finally(() => {
    prisma.$disconnect();
    pool.end();
  });
