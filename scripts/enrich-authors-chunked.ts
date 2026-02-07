/**
 * Chunked Author Enrichment Script
 * Processes authors in batches to avoid timeouts
 * 
 * Usage:
 *   npx tsx scripts/enrich-authors-chunked.ts         # Process all, 50 per batch
 *   npx tsx scripts/enrich-authors-chunked.ts --batch=100  # 100 per batch
 *   npx tsx scripts/enrich-authors-chunked.ts --dry-run    # Preview only
 *   npx tsx scripts/enrich-authors-chunked.ts --resume     # Resume from last position
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as googlebooks from '../src/lib/googlebooks';
import { writeFileSync, existsSync, readFileSync } from 'fs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const PROGRESS_FILE = '.enrich-authors-progress.json';
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

async function main() {
  const args = await getArgs();
  const batchSize = args.batchSize || 50;
  const dryRun = args.dryRun || false;
  
  console.log('=== Chunked Author Enrichment ===');
  console.log(`Batch size: ${batchSize}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);
  
  const progress = loadProgress();
  let startOffset = args.resume ? progress.lastOffset : 0;
  
  console.log(`${args.resume ? `Resuming from offset ${startOffset}...` : 'Starting fresh...'}\n`);
  
  // Get total count
  const total = await prisma.author.count({
    where: {
      OR: [
        { bio: null },
        { photoUrl: null }
      ]
    }
  });
  
  console.log(`Total authors needing enrichment: ${total}\n`);
  
  let processed = 0;
  let updated = 0;
  let batchNum = 0;
  
  while (startOffset < total) {
    batchNum++;
    console.log(`--- Batch ${batchNum} (offset ${startOffset}) ---`);
    
    const authors = await prisma.author.findMany({
      where: {
        OR: [
          { bio: null },
          { photoUrl: null }
        ]
      },
      include: {
        books: {
          include: {
            book: { select: { isbn: true, title: true } }
          },
          take: 3
        }
      },
      skip: startOffset,
      take: batchSize
    });
    
    if (authors.length === 0) {
      console.log('No more authors to process.');
      break;
    }
    
    for (const author of authors) {
      processed++;
      const authorName = author.name;
      
      // Find book with ISBN
      const bookWithIsbn = author.books.find(ba => ba.book.isbn);
      
      if (!bookWithIsbn) {
        console.log(`[${processed}] ${authorName} - no ISBN`);
        continue;
      }
      
      console.log(`[${processed}] ${authorName}`);
      
      // Search Google Books by ISBN
      const gbData = await googlebooks.searchByISBN(bookWithIsbn.book.isbn);
      
      if (gbData) {
        const gbAuthors = gbData.authors || [];
        const match = gbAuthors.some((a: string) => 
          a.toLowerCase().includes(authorName.toLowerCase().split(' ').pop() || '')
        );
        
        if (match) {
          const gbCover = googlebooks.getCoverUrl(gbData.imageLinks?.thumbnail);
          const gbDesc = gbData.description;
          
          const updateData: any = {};
          let thisUpdated = false;
          
          if (gbCover && !author.photoUrl) {
            updateData.photoUrl = gbCover;
            thisUpdated = true;
          }
          if (gbDesc && !author.bio) {
            updateData.bio = gbDesc;
            thisUpdated = true;
          }
          
          if (Object.keys(updateData).length > 0) {
            if (dryRun) {
              console.log(`  [GB] cover=${!!gbCover}, bio=${!!gbDesc}`);
            } else {
              await prisma.author.update({
                where: { id: author.id },
                data: updateData
              });
              console.log(`  ✓ Updated: cover=${!!gbCover}, bio=${!!gbDesc}`);
              updated++;
            }
          } else {
            console.log(`  - Already has data`);
          }
        } else {
          console.log(`  - Author mismatch`);
        }
      } else {
        console.log(`  - No GB data`);
      }
      
      await delay(100); // Rate limit
    }
    
    // Save progress
    const newProgress: Progress = {
      lastOffset: startOffset + authors.length,
      totalProcessed: progress.totalProcessed + authors.length,
      totalUpdated: progress.totalUpdated + updated,
      lastRun: new Date().toISOString()
    };
    saveProgress(newProgress);
    
    console.log(`Batch ${batchNum}: ${authors.length} processed, ${updated} updated this batch`);
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
  
  // Reset if complete
  if (startOffset >= total) {
    console.log('\n✅ Enrichment complete! Progress file cleared.');
    writeFileSync(PROGRESS_FILE, JSON.stringify({ lastOffset: 0, totalProcessed: 0, totalUpdated: 0, lastRun: '' }));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());