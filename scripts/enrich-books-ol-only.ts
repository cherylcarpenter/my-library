/**
 * Chunked Book Enrichment - OpenLibrary Only
 * Skip Google Books due to aggressive rate limiting
 * 
 * Usage:
 *   npx tsx scripts/enrich-books-ol-only.ts --batch=50
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as openlibrary from '../src/lib/openlibrary';
import { writeFileSync, existsSync, readFileSync } from 'fs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const PROGRESS_FILE = '.enrich-books-ol-progress.json';
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
  else args.batchSize = 50;
  
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

async function main() {
  const args = await getArgs();
  const batchSize = args.batchSize || 50;
  const dryRun = args.dryRun || false;
  
  console.log('=== Chunked Book Enrichment (OpenLibrary Only) ===');
  console.log(`Batch size: ${batchSize}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Note: Google Books skipped due to rate limits\n`);
  
  const progress = loadProgress();
  let startOffset = args.resume ? progress.lastOffset : 0;
  
  console.log(`${args.resume ? `Resuming from offset ${startOffset}...` : 'Starting fresh...'}\n`);
  
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
      const isbn = book.isbn;
      const title = book.title;
      const authorName = book.authors?.[0]?.author?.name || '';
      const needsCover = !book.coverUrl;
      const needsDesc = !book.description;
      
      if (!needsCover && !needsDesc) {
        continue;
      }
      
      if (!isbn) {
        continue;
      }
      
      const olData = await openlibrary.searchByISBN(isbn);
      if (olData) {
        const olCover = needsCover ? openlibrary.getCoverUrl(isbn) : null;
        const olDesc = needsDesc ? openlibrary.extractDescription(olData.notes || olData.description) : null;
        const olAuthors = olData.authors?.map((a: any) => a.name) || [];
        const authorMatch = validateAuthorMatch(authorName, olAuthors);
        
        // Extract first author OLID from response
        const authorOlid = olData.authors?.[0]?.key?.replace('/authors/', '') || null;
        
        if ((olCover || olDesc || authorOlid) && authorMatch >= 50) {
          if (dryRun) {
            const hasOlid = authorOlid ? `, olid=${authorOlid}` : '';
            console.log(`  [OL] ${title}: cover=${!!olCover}, desc=${!!olDesc}${hasOlid}, match=${authorMatch}%`);
          } else {
            const updateData: any = {};
            if (olCover) updateData.coverUrl = olCover;
            if (olDesc) updateData.description = olDesc;
            if (authorOlid) updateData.openLibraryId = authorOlid;
            updateData.enrichedAt = new Date();
            updateData.enrichmentStatus = 'ENRICHED';
            
            await prisma.book.update({
              where: { id: book.id },
              data: updateData
            });
            updated++;
            console.log(`  ✓ ${title}${authorOlid ? ` (OLID: ${authorOlid})` : ''}`);
          }
        }
      }
      
      await delay(600); // OpenLibrary rate limit (100/min)
    }
    
    const newProgress: Progress = {
      lastOffset: startOffset + books.length,
      totalProcessed: progress.totalProcessed + books.length,
      totalUpdated: progress.totalUpdated + updated,
      lastRun: new Date().toISOString()
    };
    saveProgress(newProgress);
    
    console.log(`Batch ${batchNum}: ${books.length} processed, ${updated - progress.totalUpdated} updated`);
    console.log(`Progress: ${newProgress.totalProcessed}/${total} total\n`);
    
    startOffset += batchSize;
  }
  
  console.log('=== Final Summary ===');
  console.log(`Total processed: ${processed}`);
  console.log(`Total updated: ${updated}`);
  
  if (dryRun) {
    console.log('\n[DRY RUN] No changes were made.');
  }
  
  if (startOffset >= total) {
    console.log('\n✅ Enrichment complete! Progress file cleared.');
    writeFileSync(PROGRESS_FILE, JSON.stringify({ lastOffset: 0, totalProcessed: 0, totalUpdated: 0, lastRun: '' }));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());