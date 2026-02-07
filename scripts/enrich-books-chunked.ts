/**
 * Chunked Book Enrichment Script
 * Processes books in batches to avoid timeouts
 * 
 * Usage:
 *   npx tsx scripts/enrich-books-chunked.ts           # Process all, 50 per batch
 *   npx tsx scripts/enrich-books-chunked.ts --batch=100  # 100 per batch
 *   npx tsx scripts/enrich-books-chunked.ts --dry-run    # Preview only
 *   npx tsx scripts/enrich-books-chunked.ts --resume     # Resume from last position
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as openlibrary from '../src/lib/openlibrary';
import * as googlebooks from '../src/lib/googlebooks';
import { writeFileSync, existsSync, readFileSync } from 'fs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const PROGRESS_FILE = '.enrich-books-progress.json';
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface Args {
  batchSize?: number;
  dryRun?: boolean;
  resume?: boolean;
}

interface Progress {
  lastOffset: number;
  totalProcessed: number;
  totalUpdated: number;
  lastRun: string;
}

async function getArgs(): Promise<Args> {
  const args: Args = {};
  if (process.argv.includes('--dry-run')) args.dryRun = true;
  if (process.argv.includes('--resume')) args.resume = true;
  
  const batchArg = process.argv.find(arg => arg.startsWith('--batch='));
  if (batchArg) args.batchSize = parseInt(batchArg.split('=')[1]);
  else args.batchSize = 50; // Default batch size
  
  return args;
}

function loadProgress(): Progress {
  if (existsSync(PROGRESS_FILE)) {
    return JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'));
  }
  return { lastOffset: 0, totalProcessed: 0, totalUpdated: 0, lastRun: '' };
}

function saveProgress(progress: Progress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function validateAuthorMatch(targetAuthor: string, sourceAuthors: string[]): number {
  if (!targetAuthor || !sourceAuthors || sourceAuthors.length === 0) return 0;
  
  const targetLower = targetAuthor.toLowerCase();
  const targetParts = targetLower.split(' ');
  const targetLastName = targetParts[targetParts.length - 1];
  
  for (const author of sourceAuthors) {
    const authorLower = author.toLowerCase();
    const authorParts = authorLower.split(' ');
    const authorLastName = authorParts[authorParts.length - 1];
    
    if (authorLower === targetLower) return 100;
    if (targetLastName && authorLastName === targetLastName) return 80;
    if (authorLower.includes(targetLower) || targetLower.includes(authorLower)) return 30;
  }
  return 0;
}

async function enrichBook(book: any, dryRun: boolean): Promise<boolean> {
  const isbn = book.isbn;
  const title = book.title;
  const authorName = book.authors?.[0]?.author?.name || '';
  
  // Only add covers if missing (don't overwrite)
  const needsCover = !book.coverUrl;
  const needsDesc = !book.description;
  
  if (!needsCover && !needsDesc) {
    return false; // Nothing to do
  }
  
  // Try OpenLibrary first (more accurate covers)
  if (isbn && (needsCover || needsDesc)) {
    const olData = await openlibrary.searchByISBN(isbn);
    if (olData) {
      const olCover = needsCover ? openlibrary.getCoverUrl(isbn) : null;
      const olDesc = needsDesc ? openlibrary.extractDescription(olData.notes || olData.description) : null;
      const olAuthors = olData.authors?.map((a: any) => a.name) || [];
      const authorMatch = validateAuthorMatch(authorName, olAuthors);
      
      if ((olCover || olDesc) && authorMatch >= 50) {
        if (dryRun) {
          console.log(`  [OL] ${title}: cover=${!!olCover}, desc=${!!olDesc}, match=${authorMatch}%`);
        } else {
          const updateData: any = {};
          if (olCover) updateData.coverUrl = olCover;
          if (olDesc) updateData.description = olDesc;
          updateData.enrichedAt = new Date();
          updateData.enrichmentStatus = 'ENRICHED';
          
          await prisma.book.update({
            where: { id: book.id },
            data: updateData
          });
          return true;
        }
      }
    }
  }
  
  // Try Google Books as fallback (descriptions only, skip covers)
  if (isbn && needsDesc && !book.description) {
    const gbData = await googlebooks.searchByISBN(isbn);
    if (gbData) {
      const gbDesc = gbData.description;
      if (gbDesc) {
        if (dryRun) {
          console.log(`  [GB] ${title}: desc=yes`);
        } else {
          await prisma.book.update({
            where: { id: book.id },
            data: {
              description: gbDesc,
              enrichedAt: new Date(),
              enrichmentStatus: 'ENRICHED'
            }
          });
          return true;
        }
      }
    }
  }
  
  return false;
}

async function main() {
  const args = await getArgs();
  const batchSize = args.batchSize || 50;
  const dryRun = args.dryRun || false;
  
  console.log('=== Chunked Book Enrichment ===');
  console.log(`Batch size: ${batchSize}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);
  
  const progress = loadProgress();
  let startOffset = args.resume ? progress.lastOffset : 0;
  
  console.log(`${args.resume ? `Resuming from offset ${startOffset}...` : 'Starting fresh...'}\n`);
  
  // Get total count
  const total = await prisma.book.count({
    where: {
      OR: [
        { description: null },
        { enrichmentStatus: 'PENDING' },
        { enrichmentStatus: 'PARTIAL' }
      ]
    }
  });
  
  console.log(`Total books needing enrichment: ${total}\n`);
  
  let processed = 0;
  let updated = 0;
  let batchNum = 0;
  
  while (startOffset < total) {
    batchNum++;
    console.log(`--- Batch ${batchNum} (offset ${startOffset}) ---`);
    
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
      skip: startOffset,
      take: batchSize
    });
    
    if (books.length === 0) {
      console.log('No more books to process.');
      break;
    }
    
    for (const book of books) {
      processed++;
      const success = await enrichBook(book, dryRun);
      if (success) updated++;
      await delay(200); // Rate limit (200ms = 5 req/sec)
    }
    
    // Save progress
    const newProgress: Progress = {
      lastOffset: startOffset + books.length,
      totalProcessed: progress.totalProcessed + books.length,
      totalUpdated: progress.totalUpdated + updated,
      lastRun: new Date().toISOString()
    };
    saveProgress(newProgress);
    
    console.log(`Batch ${batchNum}: ${books.length} processed, ${updated} updated this batch`);
    console.log(`Progress: ${newProgress.totalProcessed}/${total} total\n`);
    
    startOffset += batchSize;
  }
  
  console.log('=== Final Summary ===');
  console.log(`Total processed: ${processed}`);
  console.log(`Total updated: ${updated}`);
  console.log(`Progress file: ${PROGRESS_FILE}`);
  
  if (dryRun) {
    console.log('\n[DRY RUN] No changes were made.');
    console.log(`Remove --dry-run to run for real.`);
  }
  
  // Reset progress file if fully complete
  if (startOffset >= total) {
    console.log('\n✅ Enrichment complete! Progress file cleared.');
    writeFileSync(PROGRESS_FILE, JSON.stringify({ lastOffset: 0, totalProcessed: 0, totalUpdated: 0, lastRun: '' }));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());