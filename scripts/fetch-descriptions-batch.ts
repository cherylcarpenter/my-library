/**
 * Batched Book Description Fetcher - OpenLibrary Scraper
 * Fetches descriptions from OpenLibrary work pages
 * Run: npx tsx scripts/fetch-descriptions-batch.ts
 */

import 'dotenv/config';
import * as fs from 'fs';

const CSV_FILE = 'missing-descriptions.csv';
const OUTPUT_FILE = 'missing-descriptions-filled.csv';
const PROGRESS_FILE = '.fetch-descriptions-progress.json';

interface BookRow {
  title: string;
  author: string;
  isbn: string;
  openLibraryId: string;
  url: string;
}

interface Progress {
  lastIndex: number;
  found: number;
  failed: number;
  lastRun: string;
}

async function getArgs() {
  const args: any = {};
  if (process.argv.includes('--dry-run')) args.dryRun = true;
  if (process.argv.includes('--resume')) args.resume = true;
  
  const batchArg = process.argv.find(arg => arg.startsWith('--batch='));
  if (batchArg) args.batchSize = parseInt(batchArg.split('=')[1]);
  else args.batchSize = 10;
  
  return args;
}

function loadProgress(): Progress {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  }
  return { lastIndex: 0, found: 0, failed: 0, lastRun: '' };
}

function saveProgress(progress: Progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function fetchDescription(isbn: string, openLibraryId: string): Promise<string | null> {
  // Try OpenLibrary works API (has descriptions)
  if (openLibraryId) {
    try {
      // Convert work ID to OLID format
      let workOlid = openLibraryId;
      if (workOlid.includes('/works/')) {
        workOlid = workOlid.replace('/works/OL', '').replace('OL', '').replace('W', '');
      }
      // Remove any non-OLID characters
      workOlid = workOlid.replace(/[^A-Z0-9]/g, '');
      
      const url = `https://openlibrary.org/works/OL${workOlid}W.json`;
      const res = await fetch(url);
      
      if (res.ok) {
        const data = await res.json();
        
        // Check for description field
        if (data.description) {
          const desc = typeof data.description === 'string'
            ? data.description
            : data.description.value || '';
          if (desc && desc.length > 50) {
            return desc.substring(0, 2000);
          }
        }
        
        // Check for excerpt
        if (data.excerpts && Array.isArray(data.excerpts) && data.excerpts.length > 0) {
          const excerpt = data.excerpts[0]?.quote || '';
          if (excerpt.length > 100) {
            return excerpt.substring(0, 2000);
          }
        }
      }
    } catch (e) {
      // Continue to next method
    }
  }
  
  // Try ISBN lookup via works API
  if (isbn) {
    try {
      const searchUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(isbn)}&limit=1`;
      const searchRes = await fetch(searchUrl);
      
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const doc = searchData.docs?.[0];
        
        if (doc?.key) {
          // Fetch the work
          const workOlid = doc.key.replace('/works/OL', '').replace('OL', '').replace('W', '');
          const workUrl = `https://openlibrary.org/works/OL${workOlid}W.json`;
          const workRes = await fetch(workUrl);
          
          if (workRes.ok) {
            const workData = await workRes.json();
            if (workData.description) {
              const desc = typeof workData.description === 'string'
                ? workData.description
                : workData.description.value || '';
              if (desc && desc.length > 50) {
                return desc.substring(0, 2000);
              }
            }
          }
        }
      }
    } catch (e) {
      // Continue
    }
  }
  
  return null;
}

async function main() {
  const args = await getArgs();
  const batchSize = args.batchSize || 10;
  const dryRun = args.dryRun || false;
  
  console.log('=== Batched Description Fetcher (OpenLibrary) ===');
  console.log(`Batch size: ${batchSize}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);
  
  // Read CSV
  const content = fs.readFileSync(CSV_FILE, 'utf-8');
  const lines = content.trim().split('\n');
  const books: BookRow[] = lines.slice(1).map((line) => {
    const values = line.split(',');
    return {
      title: values[0] || '',
      author: values[1] || '',
      isbn: values[2] || '',
      openLibraryId: values[3] || '',
      url: values[4] || ''
    };
  });
  
  const progress = loadProgress();
  let startIndex = args.resume ? progress.lastIndex : 0;
  
  console.log(`Total books: ${books.length}`);
  console.log(`${args.resume ? `Resuming from index ${startIndex}...` : 'Starting fresh...'}\n`);
  
  let found = progress.found;
  let failed = progress.failed;
  const results: Array<BookRow & { description?: string }> = [];
  
  for (let i = startIndex; i < books.length; i++) {
    const book = books[i];
    
    // Rate limiting: 600ms between requests
    await new Promise(r => setTimeout(r, 600));
    
    console.log(`[${i + 1}/${books.length}] ${book.title.substring(0, 35)}...`);
    
    const description = await fetchDescription(book.isbn, book.openLibraryId);
    
    const result: any = { ...book };
    if (description) {
      found++;
      result.description = description;
      console.log(`  ✓ Found (${description.length} chars)`);
    } else {
      failed++;
      console.log(`  ✗ Not found`);
    }
    
    results.push(result);
    
    // Save progress every 20 books
    if ((i + 1) % 20 === 0) {
      const newProgress: Progress = {
        lastIndex: i + 1,
        found,
        failed,
        lastRun: new Date().toISOString()
      };
      saveProgress(newProgress);
      
      // Save partial results
      if (!dryRun) {
        saveResults(results, books);
      }
      
      console.log(`\n--- Progress: ${i + 1}/${books.length} ---`);
      console.log(`Found: ${found}, Failed: ${failed}\n`);
    }
  }
  
  // Save final results
  if (!dryRun) {
    saveResults(results, books);
  }
  
  // Final summary
  console.log('\n=== Final Summary ===');
  console.log(`Total processed: ${books.length}`);
  console.log(`Descriptions found: ${found}`);
  console.log(`Descriptions not found: ${failed}`);
  
  if (dryRun) {
    console.log('\n[DRY RUN] No changes were made.');
  }
  
  // Clear progress on completion
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ lastIndex: 0, found: 0, failed: 0, lastRun: '' }));
  console.log('\n✅ Complete!');
}

function saveResults(results: any[], allBooks: BookRow[]) {
  // Create filled CSV with descriptions
  let csv = 'title,author,isbn,openLibraryId,url,description\n';
  for (const book of results) {
    const desc = book.description ? `"${book.description.replace(/"/g, '""')}"` : '';
    csv += `"${book.title}","${book.author}","${book.isbn}","${book.openLibraryId}","${book.url}",${desc}\n`;
  }
  fs.writeFileSync(OUTPUT_FILE, csv);
}

main().catch(console.error);
