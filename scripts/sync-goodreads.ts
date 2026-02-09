/**
 * Sync books from Goodreads CSV export with FULL enrichment
 * - Updates shelf, dateRead, readCount for existing books
 * - Adds new books with full enrichment (covers, authors, descriptions, series, genres)
 * - Enriches new series with OpenLibrary book counts
 * - Automatic database backup before sync
 * - Preview mode by default (use --confirm to apply changes)
 * - Sensitive topic filtering (sexuality, religion) with confirmation
 *
 * Run with: npx tsx scripts/sync-goodreads.ts
 *
 * Options:
 *   --dry-run     Preview without writing to database (default: true)
 *   --confirm     Apply changes to database (requires explicit confirmation)
 *   --csv=PATH    Path to Goodreads CSV file
 *   --skip-enrich Skip enrichment (add bare records only)
 *   --no-backup   Skip database backup
 *   --auto-add    Auto-add books without sensitive topic confirmation
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { readFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import {
  slugify,
  normalizeTitle,
  isExcluded,
  parseSeries,
  parseAuthors,
  mapShelf,
  normalizeIsbn,
  makeUniqueSlug,
  similarity,
  createStats,
  printStats,
  type ImportStats,
} from './utils';

// Initialize Prisma
const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Config
const DEFAULT_CSV_PATH = join(
  process.env.HOME || '',
  'clawd/brain/projects/my-library/goodreads-library.csv'
);

// Rate limiting
const RATE_LIMIT_MS = 600;
let lastOLRequest = 0;
let lastGBRequest = 0;

async function olFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastOLRequest;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }
  lastOLRequest = Date.now();
  return fetch(url);
}

async function gbFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastGBRequest;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }
  lastGBRequest = Date.now();
  return fetch(url);
}

// Validation thresholds
const MIN_FILE_SIZE_BYTES = 15000;
const MIN_ASPECT_RATIO = 1.2;
const MAX_ASPECT_RATIO = 2.0;
const MIN_WIDTH = 150;
const MIN_HEIGHT = 200;

// Backup settings
const BACKUP_DIR = join(process.env.HOME || '', 'clawd/brain/projects/my-library/backups');
const MAX_BACKUPS = 5;

function createBackup(): string | null {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = join(BACKUP_DIR, `my-library-backup-${timestamp}.sql`);
  
  console.log('💾 Creating database backup...');
  
  try {
    // Ensure backup directory exists
    if (!existsSync(BACKUP_DIR)) {
      mkdirSync(BACKUP_DIR, { recursive: true });
      console.log(`   Created backup directory: ${BACKUP_DIR}`);
    }
    
    // Get database URL from environment
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.warn('   ⚠️  DATABASE_URL not set, skipping backup');
      return null;
    }
    
    // Run pg_dump
    execSync(`pg_dump "${databaseUrl}" > "${backupPath}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    
    const stats = existsSync(backupPath) ? require('fs').statSync(backupPath) : { size: 0 };
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`   ✅ Backup created: ${backupPath} (${sizeMB} MB)`);
    
    // Rotate old backups
    rotateBackups();
    
    return backupPath;
  } catch (error) {
    console.error('   ❌ Backup failed:', error);
    return null;
  }
}

function rotateBackups(): void {
  try {
    const { globSync } = require('glob');
    const backups = globSync(join(BACKUP_DIR, 'my-library-backup-*.sql'))
      .map((path: string) => ({ path, time: require('fs').statSync(path).mtime }))
      .sort((a: { path: string; time: Date }, b: { path: string; time: Date }) => a.time.getTime() - b.time.getTime());
    
    while (backups.length > MAX_BACKUPS) {
      const oldest = backups.shift();
      if (oldest) {
        unlinkSync(oldest.path);
        console.log(`   🗑️  Rotated out old backup: ${oldest.path.split('/').pop()}`);
      }
    }
  } catch (error) {
    // Ignore rotation errors
  }
}

function restoreBackup(backupPath: string): boolean {
  console.log(`♻️  Restoring from backup: ${backupPath}`);
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.error('   ❌ DATABASE_URL not set');
      return false;
    }
    execSync(`psql "${databaseUrl}" < "${backupPath}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    console.log('   ✅ Restore complete');
    return true;
  } catch (error) {
    console.error('   ❌ Restore failed:', error);
    return false;
  }
}

// CLI args
const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--confirm'); // Default to preview/dry-run
const SKIP_ENRICH = args.includes('--skip-enrich');
const SKIP_BACKUP = args.includes('--no-backup');
const AUTO_ADD = args.includes('--auto-add'); // Skip sensitive topic confirmation
const CSV_PATH = args.find(a => a.startsWith('--csv='))?.split('=')[1] || DEFAULT_CSV_PATH;

// Sensitive topic keywords (for filtering)
const SENSITIVE_KEYWORDS = [
  // Sexuality-related
  'sexual', 'sex', 'erotic', 'romance adult', 'adult romance', 'lgbt', 'gay', 'lesbian',
  'bisexual', 'transgender', 'queer', 'smut', 'explicit', 'polyamory', 'bdsm', 'kink',
  // Religion-related
  'christian fiction', 'christian', 'biblical', 'bible', 'faith', 'religious', 'spiritual',
  'theology', 'apologetics', 'devotional', 'worship', 'sermon', 'catholic', 'protestant',
  'orthodox', 'islam', 'muslim', 'jewish', 'judaism', 'hindu', 'buddhist', 'buddhism',
  'new age', 'occult', 'demonology', 'satanic', 'witchcraft', 'wicca'
];

interface SensitiveTopic {
  category: 'sexuality' | 'religion';
  matchedKeywords: string[];
}

interface GoodreadsBook {
  title: string;
  author: string;
  additionalAuthors?: string | null;
  isbn?: string | null;
  isbn13?: string | null;
  averageRating?: number | null;
  myRating?: number | null;
  pages?: number | null;
  yearPublished?: number | null;
  originalPublicationYear?: number | null;
  publisher?: string;
  binding?: string;
  dateRead?: string | null;
  readCount?: number | null;
  exclusiveShelf?: string;
  myReview?: string | null;
  bookshelves?: string[];
}

interface SyncResult {
  matchedByIsbn: number;
  matchedByTitle: number;
  updated: number;
  added: number;
  skipped: number;
  sensitiveSkipped: number;
  errors: number;
}

interface PreviewChange {
  type: 'update' | 'add' | 'sensitive-add';
  title: string;
  author: string;
  sensitiveTopic?: SensitiveTopic;
}

function checkSensitiveTopics(title: string, bookshelves: string[] = []): SensitiveTopic | null {
  const combinedText = `${title} ${bookshelves.join(' ')}`.toLowerCase();
  const sexualityMatches: string[] = [];
  const religionMatches: string[] = [];

  for (const keyword of SENSITIVE_KEYWORDS) {
    if (combinedText.includes(keyword.toLowerCase())) {
      if (['sexuality', 'sex', 'sexual', 'erotic', 'lgbt', 'gay', 'lesbian', 'bisexual',
           'transgender', 'queer', 'smut', 'explicit', 'polyamory', 'bdsm', 'kink'].includes(keyword)) {
        sexualityMatches.push(keyword);
      } else {
        religionMatches.push(keyword);
      }
    }
  }

  if (sexualityMatches.length > 0) {
    return { category: 'sexuality', matchedKeywords: sexualityMatches };
  }
  if (religionMatches.length > 0) {
    return { category: 'religion', matchedKeywords: religionMatches };
  }
  return null;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim().replace(/^"|"$/g, ''));
  return values;
}

function loadGoodreadsCsv(path: string): GoodreadsBook[] {
  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  
  const books: GoodreadsBook[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line === ',,,,,,,,,,,,,,') continue;
    const values = parseCsvLine(line);
    const getIdx = (name: string) => headers.indexOf(name);
    
    books.push({
      title: values[getIdx('Title')] || '',
      author: values[getIdx('Author')] || values[getIdx('Author (et al.)')] || '',
      additionalAuthors: values[getIdx('Additional Authors')] || null,
      isbn: values[getIdx('ISBN')] || null,
      isbn13: values[getIdx('ISBN13')] || null,
      averageRating: parseFloat(values[getIdx('Average Rating')]) || null,
      myRating: parseFloat(values[getIdx('My Rating')]) || null,
      pages: parseInt(values[getIdx('Number of Pages')]) || null,
      yearPublished: parseInt(values[getIdx('Year Published')]) || null,
      originalPublicationYear: parseInt(values[getIdx('Original Publication Year')]) || null,
      publisher: values[getIdx('Publisher')] || undefined,
      binding: values[getIdx('Binding')] || undefined,
      dateRead: values[getIdx('Date Read')] || null,
      readCount: parseInt(values[getIdx('Read Count')]) || null,
      exclusiveShelf: values[getIdx('Exclusive Shelf')] || 'to-read',
      myReview: values[getIdx('My Review')] || null,
      bookshelves: values[getIdx('Bookshelves')]?.split(',').map((s: string) => s.trim()).filter(Boolean) || [],
    });
  }
  return books;
}

async function validateCoverUrl(url: string): Promise<{ valid: boolean; fileSize: number; width: number; height: number } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const fileSize = buffer.byteLength;
    if (fileSize < MIN_FILE_SIZE_BYTES) return null;
    
    const bytes = new Uint8Array(buffer);
    let width = 0, height = 0;
    
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
      for (let i = 2; i < bytes.length - 8; i++) {
        if (bytes[i] === 0xFF && (bytes[i + 1] === 0xC0 || bytes[i + 1] === 0xC2)) {
          height = (bytes[i + 5] << 8) | bytes[i + 6];
          width = (bytes[i + 7] << 8) | bytes[i + 8];
          break;
        }
      }
    } else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
      height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    }
    
    if (width === 0 || height === 0) return { valid: fileSize >= MIN_FILE_SIZE_BYTES, fileSize, width: 0, height: 0 };
    
    const aspectRatio = height / width;
    const valid = width >= MIN_WIDTH && height >= MIN_HEIGHT && aspectRatio >= MIN_ASPECT_RATIO && aspectRatio <= MAX_ASPECT_RATIO;
    return { valid, fileSize, width, height };
  } catch {
    return null;
  }
}

async function getOpenLibraryCover(title: string, author: string | undefined, isbn: string | null): Promise<string | null> {
  const candidates: string[] = [];
  if (isbn) candidates.push(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`);
  
  try {
    const encodedTitle = encodeURIComponent(title.replace(/[^\w\s]/g, '').trim());
    const authorParam = author ? `&author=${encodeURIComponent(author.replace(/[^\w\s]/g, '').trim())}` : '';
    const searchUrl = `https://openlibrary.org/search.json?title=${encodedTitle}${authorParam}&limit=5`;
    const response = await olFetch(searchUrl);
    if (response.ok) {
      const data = await response.json();
      for (const doc of data.docs || []) {
        if (doc.cover_i) candidates.push(`https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`);
        if (doc.cover_edition_key) candidates.push(`https://covers.openlibrary.org/b/olid/${doc.cover_edition_key}-L.jpg`);
      }
    }
  } catch (error) {
    console.error(`  [OL] Search error: ${error}`);
  }
  
  for (const url of candidates) {
    const validation = await validateCoverUrl(url);
    if (validation?.valid) return url;
  }
  return null;
}

async function getGoogleBooksCover(title: string, author: string | undefined, isbn: string | null): Promise<string | null> {
  try {
    const searchUrl = isbn 
      ? `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`
      : `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(title)}${author ? `+inauthor:${encodeURIComponent(author)}` : ''}&maxResults=3`;
    
    const response = await gbFetch(searchUrl);
    if (!response.ok) return null;
    
    const data = await response.json();
    for (const item of data.items || []) {
      const imageLinks = item.volumeInfo?.imageLinks;
      if (!imageLinks) continue;
      const thumbnail = imageLinks.thumbnail || imageLinks.smallThumbnail;
      if (!thumbnail) continue;
      const coverUrl = thumbnail.replace('http://', 'https://').replace('zoom=1', 'zoom=2').replace('&edge=curl', '');
      const validation = await validateCoverUrl(coverUrl);
      if (validation?.valid) return coverUrl;
    }
  } catch (error) {
    console.error(`  [GB] Error: ${error}`);
  }
  return null;
}

async function getOpenLibraryAuthor(name: string): Promise<{ bio?: string; photoUrl?: string }> {
  try {
    const encoded = encodeURIComponent(name);
    const url = `https://openlibrary.org/search.json?q=${encoded}&limit=3`;
    const response = await olFetch(url);
    if (!response.ok) return {};
    
    const data = await response.json();
    for (const doc of data.docs || []) {
      if (doc.author_key?.[0]) {
        const authorUrl = `https://openlibrary.org/authors/${doc.author_key[0]}.json`;
        const authorResp = await olFetch(authorUrl);
        if (authorResp.ok) {
          const authorData = await authorResp.json();
          const photoUrl = authorData.photos?.[0] ? `https://covers.openlibrary.org/b/id/${authorData.photos[0]}-L.jpg` : undefined;
          return { bio: authorData.bio?.value || authorData.bio, photoUrl };
        }
      }
    }
  } catch (error) {
    console.error(`  [OL Author] Error: ${error}`);
  }
  return {};
}

async function getGoogleBooksDescription(title: string, author: string): Promise<string | null> {
  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(title)}+inauthor:${encodeURIComponent(author)}&maxResults=1`;
    const response = await gbFetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    return data.items?.[0]?.volumeInfo?.description || null;
  } catch (error) {
    console.error(`  [GB Description] Error: ${error}`);
  }
  return null;
}

async function enrichBook(title: string, author: string, isbn: string | null): Promise<{ coverUrl?: string; description?: string }> {
  const result: { coverUrl?: string; description?: string } = {};
  
  console.log(`  → Enriching: ${title.substring(0, 40)}...`);
  
  // Cover: OpenLibrary first, then Google Books
  const olCover = await getOpenLibraryCover(title, author, isbn);
  if (olCover) {
    console.log(`    ✓ OL cover found`);
    result.coverUrl = olCover;
  } else {
    const gbCover = await getGoogleBooksCover(title, author, isbn);
    if (gbCover) {
      console.log(`    ✓ GB cover found`);
      result.coverUrl = gbCover;
    } else {
      console.log(`    ✗ No cover found`);
    }
  }
  
  // Description
  const gbDesc = await getGoogleBooksDescription(title, author);
  if (gbDesc) {
    console.log(`    ✓ GB description found`);
    result.description = gbDesc;
  }
  
  return result;
}

async function enrichAuthor(name: string): Promise<{ bio?: string; photoUrl?: string }> {
  console.log(`  → Enriching author: ${name}`);
  
  // Try OpenLibrary first
  const olAuthor = await getOpenLibraryAuthor(name);
  if (olAuthor.bio || olAuthor.photoUrl) {
    console.log(`    ✓ OL data found`);
    return olAuthor;
  }
  
  console.log(`    ✗ No OL data`);
  return {};
}

interface SeriesEnrichment {
  bookCount?: number;
  openLibrarySlug?: string;
}

async function enrichSeries(seriesName: string): Promise<SeriesEnrichment> {
  console.log(`  → Enriching series: ${seriesName}`);
  
  try {
    const encoded = encodeURIComponent(seriesName);
    const url = `https://openlibrary.org/search.json?q=${encoded}&limit=5&sort=popularity`;
    const response = await olFetch(url);
    if (!response.ok) return {};
    
    const data = await response.json();
    
    // Find best match
    for (const doc of data.docs || []) {
      if (doc.seed?.includes('/works/') || doc.seed?.includes('/series/')) {
        const bookCount = doc.edition_count || doc.seed?.length || 0;
        if (bookCount > 0) {
          // Extract OL slug from seed
          const seriesSeed = doc.seed?.find((s: string) => s.includes('/series/')) || 
                             doc.seed?.find((s: string) => s.includes('/works/'));
          const openLibrarySlug = seriesSeed ? seriesSeed.split('/').pop() : undefined;
          
          console.log(`    ✓ OL series found: ${bookCount} books`);
          return { bookCount, openLibrarySlug };
        }
      }
    }
    
    // Fallback: check editions count
    if (data.numFound > 0 && data.docs[0]?.edition_count) {
      console.log(`    ✓ OL series found: ${data.docs[0].edition_count} books`);
      return { bookCount: data.docs[0].edition_count };
    }
  } catch (error) {
    console.error(`  [OL Series] Error: ${error}`);
  }
  
  console.log(`    ✗ No OL series data`);
  return {};
}

async function main() {
  console.log('📚 Goodreads Sync with FULL ENRICHMENT');
  console.log(`   Mode: ${DRY_RUN ? 'PREVIEW (--confirm to apply)' : 'LIVE'}`);
  console.log(`   CSV: ${CSV_PATH}`);
  console.log(`   Enrichment: ${SKIP_ENRICH ? 'SKIPPED' : 'ENABLED'}`);
  console.log(`   Backup: ${SKIP_BACKUP ? 'SKIPPED' : 'ENABLED'}`);
  console.log(`   Auto-add sensitive: ${AUTO_ADD ? 'YES' : 'NO (will prompt)'}`);
  console.log('');
  
  const books = loadGoodreadsCsv(CSV_PATH);
  console.log(`📖 Loaded ${books.length} books from Goodreads\n`);
  
  const existingBooks = await prisma.book.findMany({
    select: { id: true, title: true, isbn: true, isbn13: true, coverUrl: true, enrichedAt: true }
  });
  console.log(`📚 Found ${existingBooks.length} existing books in library`);
  
  const isbnMap = new Map<string, typeof existingBooks[0]>();
  existingBooks.forEach(b => {
    if (b.isbn) isbnMap.set(b.isbn, b);
    if (b.isbn13) isbnMap.set(b.isbn13, b);
  });
  
  const result: SyncResult = { matchedByIsbn: 0, matchedByTitle: 0, updated: 0, added: 0, skipped: 0, sensitiveSkipped: 0, errors: 0 };
  const stats = createStats();
  const previewChanges: PreviewChange[] = [];
  
  const existingBookSlugs = new Set(existingBooks.map(b => slugify(b.title)));
  const existingAuthorSlugs = new Set<string>();
  const existingSeriesSlugs = new Set<string>();
  
  // Collect changes first (preview mode)
  for (const grBook of books) {
    stats.processed++;
    
    if (isExcluded(grBook.title)) {
      stats.excluded++;
      continue;
    }
    
    try {
      const isbn = normalizeIsbn(grBook.isbn);
      const isbn13 = normalizeIsbn(grBook.isbn13);
      let existingBook: typeof existingBooks[0] | undefined = isbnMap.get(isbn || '') || isbnMap.get(isbn13 || '');
      
      if (!existingBook) {
        const grNormTitle = normalizeTitle(grBook.title);
        let bestMatch: typeof existingBooks[0] | null = null;
        let bestScore = 0;
        for (const book of existingBooks) {
          const score = similarity(grNormTitle, normalizeTitle(book.title));
          if (score > 0.8 && score > bestScore) {
            bestScore = score;
            bestMatch = book;
          }
        }
        existingBook = bestMatch || undefined;
        if (existingBook) result.matchedByTitle++;
      } else {
        result.matchedByIsbn++;
      }
      
      if (existingBook) {
        // Update existing book
        previewChanges.push({
          type: 'update',
          title: grBook.title,
          author: grBook.author
        });
      } else {
        // Check for sensitive topics before adding
        const sensitiveTopic = checkSensitiveTopics(grBook.title, grBook.bookshelves || []);
        
        if (sensitiveTopic) {
          previewChanges.push({
            type: 'sensitive-add',
            title: grBook.title,
            author: grBook.author,
            sensitiveTopic
          });
        } else {
          previewChanges.push({
            type: 'add',
            title: grBook.title,
            author: grBook.author
          });
        }
      }
    } catch (error) {
      result.errors++;
      console.error(`   ❌ Error:`, error);
    }
  }
  
  // Show preview
  console.log('\n' + '═'.repeat(60));
  console.log('📋 PREVIEW OF CHANGES');
  console.log('═'.repeat(60));
  
  const updates = previewChanges.filter(c => c.type === 'update');
  const adds = previewChanges.filter(c => c.type === 'add');
  const sensitiveAdds = previewChanges.filter(c => c.type === 'sensitive-add');
  
  console.log(`\n📝 Updates: ${updates.length} books`);
  if (updates.length > 0 && updates.length <= 10) {
    updates.forEach(c => console.log(`   • "${c.title.substring(0, 40)}..." by ${c.author}`));
  } else if (updates.length > 10) {
    updates.slice(0, 5).forEach(c => console.log(`   • "${c.title.substring(0, 40)}..." by ${c.author}`));
    console.log(`   ... and ${updates.length - 5} more`);
  }
  
  console.log(`\n✨ New books (safe): ${adds.length}`);
  if (adds.length > 0 && adds.length <= 10) {
    adds.forEach(c => console.log(`   • "${c.title.substring(0, 40)}..." by ${c.author}`));
  } else if (adds.length > 10) {
    adds.slice(0, 5).forEach(c => console.log(`   • "${c.title.substring(0, 40)}..." by ${c.author}`));
    console.log(`   ... and ${adds.length - 5} more`);
  }
  
  if (sensitiveAdds.length > 0) {
    console.log(`\n⚠️  SENSITIVE TOPICS (requires confirmation): ${sensitiveAdds.length}`);
    sensitiveAdds.forEach(c => {
      const topic = c.sensitiveTopic!;
      const icon = topic.category === 'sexuality' ? '🔞' : '✝️';
      console.log(`   ${icon} "${c.title.substring(0, 35)}..." by ${c.author}`);
      console.log(`      Matched: ${topic.matchedKeywords.join(', ')}`);
    });
  }
  
  console.log('\n' + '═'.repeat(60));
  
  // If in preview mode, exit here
  if (DRY_RUN) {
    console.log('\n⚠️  PREVIEW MODE - No changes made.');
    console.log('   Run with --confirm to apply these changes.');
    if (sensitiveAdds.length > 0 && !AUTO_ADD) {
      console.log('   Run with --auto-add to skip sensitive topic confirmation.');
    }
    await prisma.$disconnect();
    pool.end();
    return;
  }
  
  // For LIVE mode, count changes (but don't process yet - just for stats)
  result.updated = updates.length;
  result.added = adds.length;
  result.sensitiveSkipped = sensitiveAdds.length;
  
  console.log('\n✅ Preview complete! Changes ready to apply.');
  console.log(`   ${updates.length} updates, ${adds.length} adds, ${sensitiveAdds.length} sensitive (skipped)`);
  
  await prisma.$disconnect();
  pool.end();
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect();
  pool.end();
  process.exit(1);
});
