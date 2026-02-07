/**
 * OpenLibrary-based Author Enrichment Script
 * Enriches author bios and photos using OpenLibrary API
 * 
 * Usage:
 *   npx tsx scripts/enrich-authors-ol.ts              # Process all, 50 per batch
 *   npx tsx scripts/enrich-authors-ol.ts --batch=100  # 100 per batch
 *   npx tsx scripts/enrich-authors-ol.ts --dry-run    # Preview only
 *   npx tsx scripts/enrich-authors-ol.ts --resume     # Resume from last position
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as openlibrary from '../src/lib/openlibrary';
import { writeFileSync, existsSync, readFileSync } from 'fs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const PROGRESS_FILE = '.enrich-authors-ol-progress.json';

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
  
  console.log('=== OpenLibrary Author Enrichment ===');
  console.log(`Batch size: ${batchSize}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);
  
  const progress = loadProgress();
  let startOffset = args.resume ? progress.lastOffset : 0;
  
  console.log(`${args.resume ? `Resuming from offset ${startOffset}...` : 'Starting fresh...'}\n`);
  
  // Get total count of authors needing enrichment
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
  let skippedNoIsbn = 0;
  let skippedNoOlid = 0;
  
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
            book: { select: { isbn: true, title: true, openLibraryId: true } }
          },
          take: 5
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
      
      // Find book with OpenLibrary ID (preferred) or ISBN
      let bookWithOlid = author.books.find(ba => ba.book.openlibraryId);
      let bookWithIsbn = author.books.find(ba => ba.book.isbn && !ba.book.openlibraryId);
      
      if (!bookWithOlid && !bookWithIsbn) {
        console.log(`[${processed}] ${authorName} - no ISBN/OLID`);
        skippedNoIsbn++;
        continue;
      }
      
      console.log(`[${processed}] ${authorName}`);
      
      // Get OpenLibrary author ID
      let authorOlid: string | null = null;
      
      // Try to get OLID from book's OpenLibrary data first
      if (bookWithOlid?.book.openLibraryId) {
        const bookData = await openlibrary.searchByISBN(bookWithOlid.book.isbn || '');
        if (bookData?.authors && bookData.authors.length > 0 && bookData.authors[0].key) {
          authorOlid = bookData.authors[0].key.replace('/authors/', '');
          console.log(`  📚 Found OLID from book: ${authorOlid}`);
        }
      }
      
      // If no OLID from book, try searching by title/author
      if (!authorOlid && bookWithIsbn?.book.isbn) {
        const bookData = await openlibrary.searchByISBN(bookWithIsbn.book.isbn);
        if (bookData?.authors && bookData.authors.length > 0 && bookData.authors[0].key) {
          authorOlid = bookData.authors[0].key.replace('/authors/', '');
          console.log(`  📚 Found OLID from ISBN: ${authorOlid}`);
        }
      }
      
      // Fallback: search OpenLibrary by author name directly
      if (!authorOlid) {
        console.log(`  🔍 Searching by name...`);
        const nameSearch = await openlibrary.searchAuthorsByName(authorName);
        if (nameSearch?.olid) {
          authorOlid = nameSearch.olid;
          console.log(`  📚 Found OLID from name search: ${authorOlid}`);
        }
      }
      
      if (!authorOlid) {
        console.log(`  - No author OLID found`);
        skippedNoOlid++;
        continue;
      }
      
      // Fetch author details from OpenLibrary
      const authorData = await openlibrary.getAuthor(authorOlid);
      
      if (!authorData) {
        console.log(`  - Failed to fetch author data`);
        continue;
      }
      
      // Extract bio and photo
      const bio = openlibrary.extractDescription(authorData.bio);
      const photoId = authorData.photos && authorData.photos[0] ? authorData.photos[0] : null;
      const photoUrl = photoId ? openlibrary.getAuthorPhotoUrl(photoId) : null;
      
      console.log(`  📖 bio=${!!bio}, photo=${!!photoUrl}`);
      
      // Build update data
      const updateData: any = {};
      let thisUpdated = false;
      
      if (bio && !author.bio) {
        updateData.bio = bio.substring(0, 5000); // Limit bio length
        thisUpdated = true;
      }
      if (photoUrl && !author.photoUrl) {
        updateData.photoUrl = photoUrl;
        thisUpdated = true;
      }
      
      if (Object.keys(updateData).length > 0) {
        if (dryRun) {
          console.log(`  [DRY] Would update: ${Object.keys(updateData).join(', ')}`);
        } else {
          await prisma.author.update({
            where: { id: author.id },
            data: updateData
          });
          console.log(`  ✓ Updated`);
          updated++;
        }
      } else {
        console.log(`  - Already has data`);
      }
    }
    
    // Save progress
    const newProgress: Progress = {
      lastOffset: startOffset + authors.length,
      totalProcessed: progress.totalProcessed + authors.length,
      totalUpdated: progress.totalUpdated + updated,
      lastRun: new Date().toISOString()
    };
    saveProgress(newProgress);
    
    console.log(`\nBatch ${batchNum} summary:`);
    console.log(`  Processed: ${authors.length}`);
    console.log(`  Updated: ${updated - progress.totalUpdated}`);
    console.log(`  No ISBN: ${skippedNoIsbn}`);
    console.log(`  No OLID: ${skippedNoOlid}`);
    console.log(`\nProgress: ${newProgress.totalProcessed}/${total} total\n`);
    
    startOffset += batchSize;
  }
  
  console.log('=== Final Summary ===');
  console.log(`Total processed: ${processed}`);
  console.log(`Total updated: ${updated}`);
  console.log(`Skipped (no ISBN): ${skippedNoIsbn}`);
  console.log(`Skipped (no OLID): ${skippedNoOlid}`);
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
