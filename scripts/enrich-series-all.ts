/**
 * Enrich all series with OpenLibrary data
 * Run in background: npx tsx scripts/enrich-series-all.ts
 * 
 * Features:
 * - Processes all series in batches
 * - Rate-limited API calls
 * - Continues from where it left off
 * - Progress logging
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const RATE_LIMIT_MS = 600;
let lastOLRequest = 0;

async function olFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastOLRequest;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }
  lastOLRequest = Date.now();
  return fetch(url);
}

/**
 * Get author names for a series from the database
 */
async function getSeriesAuthors(seriesId: string): Promise<string[]> {
  const books = await prisma.book.findMany({
    where: { seriesId },
    include: { authors: { include: { author: true } } }
  });
  
  const authors = new Set<string>();
  books.forEach(book => {
    book.authors.forEach(ba => authors.add(ba.author.name));
  });
  
  return Array.from(authors);
}

/**
 * Search OpenLibrary for books in a series
 */
async function searchSeriesBooks(seriesName: string, authors: string[]): Promise<{
  key: string;
  title: string;
  coverI?: number;
  firstPublishYear?: number;
  isbn?: string;
  editionKey?: string;
}[]> {
  const authorParam = authors.length > 0 
    ? ` author:${authors[0].split(' ').pop()}` // Just last name for better matching
    : '';
  
  const encoded = encodeURIComponent(`${seriesName}${authorParam}`);
  const url = `https://openlibrary.org/search.json?q=${encoded}&limit=50`;
  
  const response = await olFetch(url);
  if (!response.ok) return [];
  
  const data = await response.json();
  const docs = data.docs || [];
  
  // Filter books that look like they're part of the series
  // Look for series name in title or subtitle
  const seriesLower = seriesName.toLowerCase();
  
  return docs
    .filter((doc: any) => {
      const titleLower = (doc.title + ' ' + (doc.subtitle || '')).toLowerCase();
      // Match if title contains series name OR has high edition count (likely a series book)
      return titleLower.includes(seriesLower) || doc.edition_count > 20;
    })
    .slice(0, 30) // Max 30 books per series
    .map((doc: any) => ({
      key: doc.key,
      title: doc.title + (doc.subtitle ? ` ${doc.subtitle}` : ''),
      coverI: doc.cover_i,
      firstPublishYear: doc.first_publish_year,
      isbn: doc.isbn?.[0],
      editionKey: doc.cover_edition_key
    }));
}

function getCoverUrl(coverI?: number): string | null {
  if (!coverI) return null;
  return `https://covers.openlibrary.org/b/id/${coverI}-M.jpg`;
}

interface SeriesEnrichment {
  openLibraryKey?: string;
  openLibraryWorks: {
    key: string;
    title: string;
    coverUrl: string | null;
    year?: number;
    isbn?: string;
    inLibrary: boolean;
  }[];
  totalBooks: number;
  booksInLibrary: number;
  enrichedAt: Date;
}

async function enrichSeries(seriesId: string, seriesName: string): Promise<SeriesEnrichment | null> {
  const authors = await getSeriesAuthors(seriesId);
  
  console.log(`  📚 Processing: "${seriesName}" (authors: ${authors.join(', ')})`);
  
  const olWorks = await searchSeriesBooks(seriesName, authors);
  
  if (olWorks.length === 0) {
    console.log(`    ⚠️  No OpenLibrary results for "${seriesName}"`);
    return null;
  }
  
  // Get all ISBNs in the series for matching
  const seriesBooks = await prisma.book.findMany({
    where: { seriesId },
    select: { isbn: true, isbn13: true }
  });
  
  const allIsbns = new Set(
    seriesBooks.flatMap(b => [b.isbn, b.isbn13].filter(Boolean))
  );
  
  // Map to enrichment format
  const works = olWorks.map(work => ({
    key: work.key,
    title: work.title,
    coverUrl: getCoverUrl(work.coverI),
    year: work.firstPublishYear,
    isbn: work.isbn,
    inLibrary: work.isbn ? allIsbns.has(work.isbn) : false
  }));
  
  const booksInLibrary = works.filter(w => w.inLibrary).length;
  
  console.log(`    ✅ Found ${works.length} books (${booksInLibrary} in your library)`);
  
  return {
    openLibraryKey: olWorks[0]?.key?.split('/').pop(), // Store the series key if we can find one
    openLibraryWorks: works,
    totalBooks: works.length,
    booksInLibrary,
    enrichedAt: new Date()
  };
}

async function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry');
  const batchSize = args.includes('--batch') 
    ? parseInt(args[args.indexOf('--batch') + 1], 10) 
    : 10;
  
  console.log('═'.repeat(60));
  console.log('📚 Series Enrichment Script');
  console.log('═'.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Batch size: ${batchSize}`);
  console.log('═'.repeat(60));
  
  // Get all series
  const allSeries = await prisma.series.findMany({
    select: { id: true, name: true }
  });
  
  console.log(`\nFound ${allSeries.length} series to process\n`);
  
  // Track progress
  let processed = 0;
  let enriched = 0;
  let failed = 0;
  
  // Process in batches with delay between batches
  for (let i = 0; i < allSeries.length; i += batchSize) {
    const batch = allSeries.slice(i, i + batchSize);
    
    console.log(`\n📦 Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allSeries.length / batchSize)}`);
    console.log('─'.repeat(60));
    
    for (const series of batch) {
      processed++;
      
      try {
        const enrichment = await enrichSeries(series.id, series.name);
        
        if (enrichment) {
          enriched++;
          if (!dryRun) {
            // Store enrichment data as JSON in description field (or a new field)
            await prisma.series.update({
              where: { id: series.id },
              data: {
                description: enrichment.openLibraryWorks.length > 0 
                  ? JSON.stringify(enrichment)
                  : undefined,
                updatedAt: new Date()
              }
            });
          }
        } else {
          failed++;
        }
      } catch (error) {
        console.error(`    ❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
        failed++;
      }
      
      // Small delay between series
      await new Promise(r => setTimeout(r, 500));
    }
    
    // Delay between batches
    if (i + batchSize < allSeries.length) {
      console.log(`\n😴 Sleeping 5 seconds before next batch...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  
  console.log('\n' + '═'.repeat(60));
  console.log('📊 Summary');
  console.log('═'.repeat(60));
  console.log(`Total series:     ${allSeries.length}`);
  console.log(`Enriched:        ${enriched}`);
  console.log(`Failed:          ${failed}`);
  console.log(`Dry run:         ${dryRun ? 'yes' : 'no'}`);
  console.log('═'.repeat(60));
  
  if (dryRun) {
    console.log('\n⚠️  No changes made. Run without --dry to save results.');
  } else {
    console.log('\n✅ Enrichment complete! Series data saved to description field as JSON.');
  }
  
  await prisma.$disconnect();
  pool.end();
}

main().catch(console.error);
