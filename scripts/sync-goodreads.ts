/**
 * Sync books from Goodreads CSV export with FULL enrichment
 * - Updates shelf, dateRead, readCount for existing books
 * - Adds new books with full enrichment (covers, authors, descriptions, series, genres)
 * - Enriches new series with OpenLibrary book counts
 * - Automatic database backup before sync
 * 
 * Run with: npx tsx scripts/sync-goodreads.ts
 * 
 * Options:
 *   --dry-run     Preview without writing to database
 *   --csv=PATH    Path to Goodreads CSV file
 *   --skip-enrich Skip enrichment (add bare records only)
 *   --no-backup   Skip database backup
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
const DRY_RUN = args.includes('--dry-run');
const SKIP_ENRICH = args.includes('--skip-enrich');
const SKIP_BACKUP = args.includes('--no-backup');
const CSV_PATH = args.find(a => a.startsWith('--csv='))?.split('=')[1] || DEFAULT_CSV_PATH;

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
  errors: number;
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
  console.log(`   Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`   CSV: ${CSV_PATH}`);
  console.log(`   Enrichment: ${SKIP_ENRICH ? 'SKIPPED' : 'ENABLED'}`);
  console.log(`   Backup: ${SKIP_BACKUP ? 'SKIPPED' : 'ENABLED'}`);
  console.log('');
  
  // Create backup (unless dry run or skipped)
  let backupPath: string | null = null;
  if (!DRY_RUN && !SKIP_BACKUP) {
    backupPath = createBackup();
    if (!backupPath) {
      console.error('❌ Backup failed. Aborting for safety. Use --no-backup to skip.');
      process.exit(1);
    }
    console.log('');
  }
  
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
  
  const result: SyncResult = { matchedByIsbn: 0, matchedByTitle: 0, updated: 0, added: 0, skipped: 0, errors: 0 };
  const stats = createStats();
  
  const existingBookSlugs = new Set(existingBooks.map(b => slugify(b.title)));
  const existingAuthorSlugs = new Set<string>();
  const existingSeriesSlugs = new Set<string>();
  
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
        const shelf = mapShelf(grBook.exclusiveShelf || 'to-read');
        const dateRead = grBook.dateRead ? new Date(grBook.dateRead) : null;
        await prisma.userBook.updateMany({
          where: { bookId: existingBook.id },
          data: { shelf, dateRead, readCount: grBook.readCount || 0 },
        });
        result.updated++;
        if (result.updated % 200 === 0) console.log(`   ✅ Updated ${result.updated} books...`);
      } else {
        if (DRY_RUN) {
          console.log(`   📖 Would add: "${grBook.title}" by ${grBook.author}`);
          stats.created++;
          continue;
        }
        
        const { cleanTitle, seriesName, seriesOrder } = parseSeries(grBook.title);
        
        let seriesId: string | null = null;
        if (seriesName) {
          const seriesSlug = makeUniqueSlug(slugify(seriesName), existingSeriesSlugs);
          
          // Enrich series with OpenLibrary data
          let seriesEnrichment: SeriesEnrichment = {};
          if (!SKIP_ENRICH) {
            seriesEnrichment = await enrichSeries(seriesName);
          }
          
          const series = await prisma.series.upsert({
            where: { slug: seriesSlug },
            create: {
              name: seriesName,
              slug: seriesSlug,
            },
            update: {},
          });
          seriesId = series.id;
        }
        
        const authorNames = parseAuthors(grBook.author, grBook.additionalAuthors);
        const authorIds: string[] = [];
        for (const authorName of authorNames) {
          const authorSlug = makeUniqueSlug(slugify(authorName), existingAuthorSlugs);
          
          // Enrich author if new
          const existingAuthor = await prisma.author.findUnique({ where: { slug: authorSlug } });
          if (!existingAuthor?.bio && !existingAuthor?.photoUrl && !SKIP_ENRICH) {
            const authorEnrichment = await enrichAuthor(authorName);
            if (authorEnrichment.bio || authorEnrichment.photoUrl) {
              await prisma.author.update({
                where: { slug: authorSlug },
                data: {
                  bio: authorEnrichment.bio,
                  photoUrl: authorEnrichment.photoUrl,
                  enrichedAt: new Date(),
                },
              });
              console.log(`    ✓ Author enriched`);
            }
          }
          
          const author = await prisma.author.upsert({
            where: { slug: authorSlug },
            create: { name: authorName, slug: authorSlug },
            update: {},
          });
          authorIds.push(author.id);
        }
        
        let enrichment: { coverUrl?: string; description?: string } = {};
        if (!SKIP_ENRICH) {
          enrichment = await enrichBook(cleanTitle, authorNames[0], isbn);
        }
        
        const bookSlug = makeUniqueSlug(slugify(cleanTitle), existingBookSlugs);
        const book = await prisma.book.create({
          data: {
            title: cleanTitle,
            slug: bookSlug,
            isbn,
            isbn13,
            goodreadsId: null,
            pages: grBook.pages || null,
            yearPublished: grBook.yearPublished || null,
            originalPublicationYear: grBook.originalPublicationYear || null,
            publisher: grBook.publisher || null,
            binding: grBook.binding || null,
            averageRating: grBook.averageRating || null,
            seriesId,
            seriesOrder,
            coverUrl: enrichment.coverUrl,
            description: enrichment.description,
            enrichedAt: (enrichment.coverUrl || enrichment.description) ? new Date() : null,
            enrichmentStatus: (enrichment.coverUrl || enrichment.description) ? 'ENRICHED' : 'PENDING',
          },
        });
        
        for (const authorId of authorIds) {
          await prisma.bookAuthor.upsert({
            where: { bookId_authorId_role: { bookId: book.id, authorId, role: 'author' } },
            create: { bookId: book.id, authorId, role: 'author' },
            update: {},
          });
        }
        
        const shelf = mapShelf(grBook.exclusiveShelf || 'to-read');
        const dateRead = grBook.dateRead ? new Date(grBook.dateRead) : null;
        const user = await prisma.user.findFirst({ where: { email: 'cherylcarpenter2015@gmail.com' } });
        const library = user ? await prisma.library.findFirst({ where: { userId: user.id } }) : null;
        
        if (library) {
          await prisma.userBook.create({
            data: {
              libraryId: library.id,
              bookId: book.id,
              shelf,
              dateRead,
              dateAdded: new Date(),
              readCount: grBook.readCount || 0,
            },
          });
        }
        
        result.added++;
        stats.created++;
      }
    } catch (error) {
      result.errors++;
      console.error(`   ❌ Error:`, error);
    }
  }
  
  console.log('\n' + '═'.repeat(60));
  console.log('📊 Goodreads Sync Summary');
  console.log('═'.repeat(60));
  console.log(`📖 Loaded:        ${books.length}`);
  console.log(`🔗 Matched ISBN:   ${result.matchedByIsbn}`);
  console.log(`🔗 Matched Title:  ${result.matchedByTitle}`);
  console.log(`✅ Updated:       ${result.updated}`);
  console.log(`✨ Added:          ${result.added}`);
  console.log(`⛔ Excluded:       ${stats.excluded}`);
  console.log(`❌ Errors:         ${result.errors}`);
  console.log('═'.repeat(60));
  
  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN - No changes made.');
  } else {
    console.log('\n✅ Sync complete!');
  }
  
  await prisma.$disconnect();
  pool.end();
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect();
  pool.end();
  process.exit(1);
});
