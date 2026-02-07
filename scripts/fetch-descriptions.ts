/**
 * Fetch book descriptions from OpenLibrary and update CSV
 * Run: npx tsx scripts/fetch-descriptions.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as openlibrary from '../src/lib/openlibrary';

const CSV_FILE = 'missing-descriptions.csv';
const OUTPUT_FILE = 'missing-descriptions-filled.csv';

interface BookRow {
  title: string;
  author: string;
  isbn: string;
  openLibraryId: string;
  url: string;
  description?: string;
}

async function main() {
  console.log('=== Fetching Book Descriptions from OpenLibrary ===\n');
  
  const content = fs.readFileSync(CSV_FILE, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',');
  
  const books: BookRow[] = lines.slice(1).map(line => {
    const values = line.split(',');
    return {
      title: values[0] || '',
      author: values[1] || '',
      isbn: values[2] || '',
      openLibraryId: values[3] || '',
      url: values[4] || ''
    };
  });
  
  console.log(`Total books to process: ${books.length}\n`);
  
  let processed = 0;
  let found = 0;
  let failed = 0;
  
  for (const book of books) {
    processed++;
    let description: string | null = null;
    
    // Try ISBN first
    if (book.isbn) {
      const data = await openlibrary.searchByISBN(book.isbn);
      if (data) {
        description = openlibrary.extractDescription(data.notes || data.description);
      }
    }
    
    // Try OpenLibrary ID if no description yet
    if (!description && book.openLibraryId && book.openLibraryId.includes('OL')) {
      // Extract OLID from URL or ID
      const olid = book.openLibraryId.replace('/works/OL', '').replace('OL', '').replace('W', '');
      const data = await openlibrary.searchByTitleAuthor(book.title, book.author);
      if (data) {
        description = openlibrary.extractDescription(data.description || data.notes);
      }
    }
    
    if (description) {
      found++;
      console.log(`[${processed}/${books.length}] ✓ ${book.title.substring(0, 40)}...`);
    } else {
      failed++;
      console.log(`[${processed}/${books.length}] ✗ ${book.title.substring(0, 40)}...`);
    }
    
    // Rate limit
    await new Promise(r => setTimeout(r, 600));
    
    // Progress every 50
    if (processed % 50 === 0) {
      console.log(`\n--- Progress: ${processed}/${books.length} ---`);
      console.log(`Found: ${found}, Failed: ${failed}\n`);
    }
  }
  
  console.log('\n=== Summary ===');
  console.log(`Total processed: ${processed}`);
  console.log(`Descriptions found: ${found}`);
  console.log(`Descriptions not found: ${failed}`);
  
  // Note: This script just counts - actual CSV update requires OpenLibrary API access
  console.log('\nNote: Run enrich-books-ol-only.ts to update the database directly.');
}

main().catch(console.error);
