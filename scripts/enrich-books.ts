/**
 * Combined Book Enrichment Script - Simplified
 * Uses OpenLibrary + Google Books with author validation
 * 
 * Run with: npx tsx scripts/enrich-books.ts
 * 
 * Options:
 *   --dry-run     Preview only, don't save
 *   --limit N     Process only N books
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as openlibrary from '../src/lib/openlibrary';
import * as googlebooks from '../src/lib/googlebooks';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface Args {
  dryRun?: boolean;
  limit?: number;
}

async function getArgs(): Promise<Args> {
  const args: Args = {};
  if (process.argv.includes('--dry-run')) args.dryRun = true;
  
  const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
  if (limitArg) args.limit = parseInt(limitArg.split('=')[1]);
  
  return args;
}

/**
 * Validate author match between target and source
 */
function validateAuthorMatch(targetAuthor: string, sourceAuthors: string[]): number {
  if (!targetAuthor || !sourceAuthors || sourceAuthors.length === 0) {
    return 0;
  }
  
  const targetLower = targetAuthor.toLowerCase();
  const targetParts = targetLower.split(' ');
  const targetLastName = targetParts[targetParts.length - 1];
  
  for (const author of sourceAuthors) {
    const authorLower = author.toLowerCase();
    const authorParts = authorLower.split(' ');
    const authorLastName = authorParts[authorParts.length - 1];
    
    // Exact match
    if (authorLower === targetLower) {
      return 100;
    }
    
    // Last name match
    if (targetLastName && authorLastName === targetLastName) {
      return 80;
    }
    
    // Partial match
    if (authorLower.includes(targetLower) || targetLower.includes(authorLower)) {
      return 30;
    }
  }
  
  return 0;
}

async function main() {
  const args = await getArgs();
  const dryRun = args.dryRun || false;
  const limit = args.limit || 100;
  
  console.log('=== Combined Book Enrichment (OL + Google Books) ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);
  
  // Find books needing enrichment
  const books = await prisma.book.findMany({
    where: {
      OR: [
        { description: null },
        { enrichmentStatus: 'PENDING' },
        { enrichmentStatus: 'PARTIAL' }
      ]
    },
    include: {
      authors: {
        include: {
          author: { select: { name: true } }
        }
      }
    },
    take: limit
  });
  
  console.log(`Found ${books.length} books needing enrichment\n`);
  
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let googleSuccess = 0;
  let openlibrarySuccess = 0;
  
  for (const book of books) {
    processed++;
    const authorName = book.authors[0]?.author?.name || '';
    const isbn = book.isbn;
    
    console.log(`[${processed}/${books.length}] ${book.title}`);
    
    // Try Google Books first
    let gbData = null;
    let gbCover = null;
    let gbDesc = null;
    
    if (isbn) {
      gbData = await googlebooks.searchByISBN(isbn);
    }
    
    if (gbData) {
      gbCover = googlebooks.getCoverUrl(gbData.imageLinks?.thumbnail);
      gbDesc = gbData.description;
      const gbAuthorMatch = validateAuthorMatch(authorName, gbData.authors || []);
      
      if (gbAuthorMatch >= 30) {
        if (dryRun) {
          console.log(`  ✓ [GB] cover=${!!gbCover}, desc=${!!gbDesc}, authorMatch=${gbAuthorMatch}%`);
        } else {
          await prisma.book.update({
            where: { id: book.id },
            data: {
              coverUrl: gbCover || book.coverUrl,
              description: gbDesc || book.description,
              enrichedAt: new Date(),
              enrichmentStatus: 'ENRICHED'
            }
          });
          console.log(`  ✓ [GB] Updated: cover=${!!gbCover}, desc=${!!gbDesc}`);
          googleSuccess++;
          updated++;
          await delay(100);
          continue; // Skip OpenLibrary if GB worked
        }
      }
    }
    
    // Try OpenLibrary as fallback
    let olData = null;
    if (isbn) {
      olData = await openlibrary.searchByISBN(isbn);
    }
    
    if (olData) {
      const olCover = isbn ? openlibrary.getCoverUrl(isbn) : null;
      const olDesc = openlibrary.extractDescription(olData.notes || olData.description);
      const olAuthorMatch = validateAuthorMatch(authorName, olData.authors?.map((a: any) => a.name) || []);
      
      if (olAuthorMatch >= 30) {
        if (dryRun) {
          console.log(`  ✓ [OL] cover=${!!olCover}, desc=${!!olDesc}, authorMatch=${olAuthorMatch}%`);
        } else {
          await prisma.book.update({
            where: { id: book.id },
            data: {
              coverUrl: olCover || book.coverUrl,
              description: olDesc || book.description,
              enrichedAt: new Date(),
              enrichmentStatus: 'ENRICHED'
            }
          });
          console.log(`  ✓ [OL] Updated: cover=${!!olCover}, desc=${!!olDesc}`);
          openlibrarySuccess++;
          updated++;
        }
      } else {
        console.log(`  - [OL] Author match too low: ${olAuthorMatch}%`);
        skipped++;
      }
    } else {
      console.log(`  - No data found`);
      skipped++;
    }
    
    await delay(100);
  }
  
  console.log('\n=== Summary ===');
  console.log(`Processed: ${processed}`);
  console.log(`Updated: ${updated}`);
  console.log(`  - Google Books: ${googleSuccess}`);
  console.log(`  - OpenLibrary: ${openlibrarySuccess}`);
  console.log(`Skipped: ${skipped}`);
  
  if (dryRun) {
    console.log('\n[DRY RUN] No changes were made.');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());