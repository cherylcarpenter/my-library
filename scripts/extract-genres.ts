/**
 * Extract genres from import data and OpenLibrary
 * Run with: npx tsx scripts/extract-genres.ts
 * 
 * This script:
 * 1. Extracts genres from Kindle, Audible, Goodreads import data
 * 2. Normalizes genre names
 * 3. Creates Genre and BookGenre records
 * 4. For books without genres, queries OpenLibrary (ISBN first, then title)
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Paths to import data
const DATA_DIR = join(process.env.HOME || '', 'clawd/brain/projects/my-library');

// Rate limiting for OpenLibrary
const RATE_LIMIT_MS = 600;
let lastRequestTime = 0;

interface Options {
  dryRun?: boolean;
  limit?: number;
  openlibrary?: boolean; // Whether to query OpenLibrary for missing genres
}

/**
 * Normalize a genre name
 */
function normalizeGenre(genre: string): string {
  if (!genre) return '';
  
  return genre
    .toLowerCase()
    .trim()
    .replace(/[^\w\s&,\-–—]/g, '') // Remove special chars
    .replace(/\s+/g, ' ')          // Single spaces
    .replace(/,&,/g, ',')          // Fix ",&," patterns
    .trim();
}

/**
 * Check if a genre looks valid (not too generic or shelf-related)
 */
function isGenreLike(genre: string): boolean {
  const excluded = [
    'fiction', 'novel', 'book', 'books',
    'history', 'biography', 'autobiography',
    'english fiction', 'american fiction',
    // Goodreads shelf patterns
    'to read', 'to-read', 'to be read',
    'currently reading', 'currently-reading', 'reading',
    'did not finish', 'did-not-finish', 'dnf',
    'owned', 'own', 'ownership',
    'kindle', 'kindle books', 'kindle unlimited',
    'audiobook', 'audio books',
    'library', 'ebooks', 'ebooks-i-own',
    'series', 'series-started', 'series-fizzled',
    'favorites', 'favourite', 'favs', 'best',
    're-read', 'reread', 'rereading',
    'wish-list', 'wishlist', 'want to buy',
    'tbr', 'tsund', 'tbr-pile',
    'pre-2012', 'pre-2012ish', 'pre-digital',
    'school', 'school-days', 'college',
    'gave-up', 'abandoned', 'paused',
    'maybe', 'someday', 'later',
    'gift', 'received', 'present',
    'memoir', 'nonfiction', 'non-fiction',
    'thriller', 'suspense', 'mystery',
    'romance', 'sci-fi', 'science fiction',
    'fantasy', 'horror', 'crime',
    'historical', 'contemporary', 'classic',
    // Custom shelf patterns (f-*, t-*, lifetime-*, 2021-*, etc.)
    'audio-listenings', 'pre-2012ish', 'pre-digital',
    'school-days', 'books-i-read-my-kids',
    'kindle', '2021-tbr-challenge', 'lifetime-favs',
    'favorites', 'favs', 'tbr-challenge',
    'tbr-pile', 'tbr-2021', 'tbr-2022',
  ];
  
  const lower = genre.toLowerCase().trim();
  
  // Check exact matches
  if (excluded.some(e => lower === e)) return false;
  
  // Check starts with excluded patterns
  if (excluded.some(e => lower.startsWith(e + ' ') || lower.startsWith(e + '-'))) return false;
  
  // Must be at least 3 characters
  if (lower.length < 3) return false;
  
  // Exclude if starts with pattern-prefixes (single letter followed by dash)
  if (/^[a-z]-/.test(lower)) return false;
  
  return true;
}

/**
 * Extract primary genre from Audible's hierarchical genre
 * "Literature & Fiction:Classics" -> "classics"
 */
function extractAudibleGenre(genre: string): string {
  if (!genre) return '';
  
  // Take the last part after colon, or the whole thing
  const parts = genre.split(':');
  let primary = parts[parts.length - 1].trim();
  
  // Normalize
  primary = normalizeGenre(primary);
  
  if (!isGenreLike(primary)) {
    // Try previous level
    for (let i = parts.length - 2; i >= 0; i--) {
      const level = normalizeGenre(parts[i]);
      if (isGenreLike(level)) {
        return level;
      }
    }
  }
  
  return primary;
}

/**
 * Extract genres from Goodreads bookshelves
 */
function extractGoodreadsGenres(bookshelves: string[]): string[] {
  const genres: Set<string> = new Set();
  
  for (const shelf of bookshelves || []) {
    const normalized = normalizeGenre(shelf);
    if (isGenreLike(normalized) && normalized.length > 2) {
      genres.add(normalized);
    }
  }
  
  return Array.from(genres);
}

/**
 * Rate-limited fetch
 */
async function rateLimitedFetch(url: string): Promise<any> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }
  
  lastRequestTime = Date.now();
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Query OpenLibrary for book subjects by ISBN
 */
async function getSubjectsByISBN(isbn: string): Promise<string[]> {
  if (!isbn) return [];
  
  try {
    const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
    const data = await rateLimitedFetch(url);
    const result = data[`ISBN:${isbn}`];
    
    if (result && result.subjects) {
      return result.subjects
        .slice(0, 5) // Take top 5
        .map((s: { name?: string } | string) => normalizeGenre(typeof s === 'string' ? s : s.name || ''))
        .filter((g: string) => g.length > 2 && isGenreLike(g));
    }
  } catch (error) {
    // Silently continue
  }
  
  return [];
}

/**
 * Query OpenLibrary by work ID (OLID) - faster than search
 */
async function getSubjectsByOLID(olid: string): Promise<string[]> {
  if (!olid) return [];
  
  try {
    const url = `https://openlibrary.org/works/${olid}.json`;
    const data = await rateLimitedFetch(url);
    
    if (data && data.subjects) {
      return data.subjects
        .slice(0, 5)
        .map((s: string) => normalizeGenre(s))
        .filter((g: string) => g.length > 2 && isGenreLike(g));
    }
  } catch (error) {
    // Silently continue
  }

  return [];
}

/**
 * Query OpenLibrary for book subjects by title/author
 */
async function getSubjectsByTitle(title: string, author?: string): Promise<string[]> {
  try {
    const encodedTitle = encodeURIComponent(title.replace(/[^\w\s]/g, '').trim().split(' ').slice(0, 5).join(' '));
    const authorParam = author ? `&author=${encodeURIComponent(author)}` : '';
    const url = `https://openlibrary.org/search.json?title=${encodedTitle}${authorParam}&limit=1`;
    
    const data = await rateLimitedFetch(url);
    
    if (data.docs && data.docs.length > 0) {
      const doc = data.docs[0];
      if (doc.subjects) {
        return doc.subjects
          .slice(0, 5)
          .map((s: string) => normalizeGenre(s))
          .filter((g: string) => g.length > 2 && isGenreLike(g));
      }
    }
  } catch (error) {
    // Silently continue
  }
  
  return [];
}

/**
 * Main extraction function
 */
async function extractGenres(options: Options = {}) {
  const { dryRun = false, limit, openlibrary = true } = options;
  
  console.log('🔍 Extracting genres...');
  console.log(`   Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`   OpenLibrary fallback: ${openlibrary ? 'YES' : 'NO'}`);
  
  // Load import data
  const genresFromSources: Map<string, { count: number; books: string[]; source: string }> = new Map();
  
  // 1. Extract from Audible
  console.log('\n📚 Loading Audible data...');
  try {
    const audiblePath = join(DATA_DIR, 'audible-library.json');
    const audibleData = JSON.parse(readFileSync(audiblePath, 'utf-8'));
    
    let extracted = 0;
    for (const book of audibleData.books || []) {
      if (book.genre) {
        const genre = extractAudibleGenre(book.genre);
        if (genre) {
          if (!genresFromSources.has(genre)) {
            genresFromSources.set(genre, { count: 0, books: [], source: 'audible' });
          }
          const g = genresFromSources.get(genre)!;
          g.count++;
          extracted++;
        }
      }
    }
    console.log(`   Extracted ${extracted} genre entries from ${audibleData.books?.length || 0} books`);
  } catch (error) {
    console.error('   Error loading Audible data:', error);
  }
  
  // 2. Extract from Kindle
  console.log('\n📚 Loading Kindle data...');
  try {
    const kindlePath = join(DATA_DIR, 'kindle-library.json');
    const kindleData = JSON.parse(readFileSync(kindlePath, 'utf-8'));
    
    let extracted = 0;
    for (const book of kindleData.books || []) {
      if (book.genre && book.genre !== 'null') {
        const genre = normalizeGenre(book.genre);
        if (genre && isGenreLike(genre)) {
          if (!genresFromSources.has(genre)) {
            genresFromSources.set(genre, { count: 0, books: [], source: 'kindle' });
          }
          const g = genresFromSources.get(genre)!;
          g.count++;
          extracted++;
        }
      }
    }
    console.log(`   Extracted ${extracted} genre entries from ${kindleData.books?.length || 0} books`);
  } catch (error) {
    console.error('   Error loading Kindle data:', error);
  }
  
  // 3. Extract from Goodreads
  console.log('\n📚 Loading Goodreads data...');
  try {
    const goodreadsPath = join(DATA_DIR, 'goodreads-library.json');
    const goodreadsData = JSON.parse(readFileSync(goodreadsPath, 'utf-8'));
    
    let extracted = 0;
    for (const book of goodreadsData.books || []) {
      const genres = extractGoodreadsGenres(book.bookshelves || []);
      for (const genre of genres) {
        if (!genresFromSources.has(genre)) {
          genresFromSources.set(genre, { count: 0, books: [], source: 'goodreads' });
        }
        const g = genresFromSources.get(genre)!;
        g.count++;
        extracted++;
      }
    }
    console.log(`   Extracted ${extracted} genre entries from ${goodreadsData.books?.length || 0} books`);
  } catch (error) {
    console.error('   Error loading Goodreads data:', error);
  }
  
  console.log(`\n📊 Total unique genres found: ${genresFromSources.size}`);
  
  // Show top genres
  const sortedGenres = Array.from(genresFromSources.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15);
  
  console.log('\nTop 15 genres:');
  for (const [name, data] of sortedGenres) {
    console.log(`   - ${name}: ${data.count} books`);
  }
  
  // If dry run, stop here
  if (dryRun) {
    console.log('\n⚠️  Dry run complete. Run without --dry to apply changes.');
    return;
  }
  
  // Create genres in database
  console.log('\n💾 Creating genres in database...');
  let genresCreated = 0;
  
  for (const [name, data] of genresFromSources) {
    const slug = name.replace(/[&,\-–—]/g, ' ').replace(/\s+/g, '-').toLowerCase();
    
    try {
      await prisma.genre.upsert({
        where: { id: slug },
        create: {
          id: slug,
          name: name.charAt(0).toUpperCase() + name.slice(1),
          slug,
          source: data.source,
          bookCount: data.count,
        },
        update: {
          bookCount: { increment: data.count },
        },
      });
      genresCreated++;
    } catch (error) {
      console.error(`   Error creating genre "${name}":`, error);
    }
  }
  
  console.log(`   Created/updated ${genresCreated} genres`);
  
  // Get all books without genres
  console.log('\n📚 Finding books without genres...');
  
  interface BookWithoutGenres {
    id: string;
    title: string;
    isbn: string | null;
    openLibraryId: string | null;
    authors: { author: { name: string } }[];
  }
  
  const booksWithoutGenres = await prisma.$queryRaw`
    SELECT b.id, b.title, b.isbn, b."openLibraryId"
    FROM "Book" b
    LEFT JOIN "BookGenre" bg ON b.id = bg."bookId"
    WHERE bg."bookId" IS NULL
    LIMIT ${limit || 1000}
  ` as BookWithoutGenres[];
  
  console.log(`   Found ${booksWithoutGenres.length} books without genres`);
  
  // Query OpenLibrary for each book without genres
  if (openlibrary && booksWithoutGenres.length > 0) {
    console.log('\n🔍 Querying OpenLibrary for missing genres...');
    
    let olQueried = 0;
    let genresAdded = 0;
    
    for (const book of booksWithoutGenres) {
      const authorName = book.authors?.[0]?.author?.name;
      
      // Priority: OLID (fastest) → ISBN → Title
      let subjects: string[] = [];
      
      // Try OLID first (work endpoint, very fast)
      if (book.openLibraryId) {
        subjects = await getSubjectsByOLID(book.openLibraryId);
      }
      
      // Fallback to ISBN
      if (subjects.length === 0 && book.isbn) {
        subjects = await getSubjectsByISBN(book.isbn);
      }
      
      // Fallback to title search
      if (subjects.length === 0 && authorName) {
        subjects = await getSubjectsByTitle(book.title, authorName);
      }
      
      if (subjects.length > 0) {
        // Create genres and link to book
        for (const subject of subjects.slice(0, 3)) {
          const slug = subject.replace(/[&,\-–—]/g, ' ').replace(/\s+/g, '-').toLowerCase();
          
          // Upsert genre
          await prisma.genre.upsert({
            where: { id: slug },
            create: {
              id: slug,
              name: subject.charAt(0).toUpperCase() + subject.slice(1),
              slug,
              source: 'openlibrary',
              bookCount: 1,
            },
            update: {
              bookCount: { increment: 1 },
            },
          });
          
          // Link to book
          await prisma.bookGenre.upsert({
            where: {
              bookId_genreId: {
                bookId: book.id,
                genreId: slug,
              },
            },
            create: {
              bookId: book.id,
              genreId: slug,
              source: 'openlibrary',
            },
            update: {},
          });
          
          genresAdded++;
        }
        
        olQueried++;
        console.log(`   ✓ ${book.title.substring(0, 40)}: ${subjects.length} subjects`);
      }
      
      // Progress indicator
      process.stdout.write(`   Progress: ${olQueried}/${booksWithoutGenres.length}\r`);
    }
    
    console.log(`\n   Queried ${olQueried} books, added ${genresAdded} genre links from OpenLibrary`);
  }
  
  // Update genre book counts
  console.log('\n📊 Updating genre book counts...');
  await prisma.$queryRaw`
    UPDATE "Genre" g
    SET "bookCount" = (
      SELECT COUNT(*) FROM "BookGenre" bg WHERE bg."genreId" = g.id
    )
  `;
  
  console.log('\n✅ Genre extraction complete!');
  
  // Show final stats
  const totalGenres = await prisma.genre.count();
  const totalLinks = await prisma.bookGenre.count();
  const booksWithGenres = await prisma.$queryRaw`SELECT COUNT(DISTINCT "bookId") FROM "BookGenre"` as { count: string }[];
  
  console.log('\n📊 Final Stats:');
  console.log(`   Total genres: ${totalGenres}`);
  console.log(`   Total book-genre links: ${totalLinks}`);
  console.log(`   Books with genres: ${booksWithGenres[0]?.count || 0}`);
}

// Parse args
const args = process.argv.slice(2);
const options: Options = {
  dryRun: args.includes('--dry'),
  limit: args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : undefined,
  openlibrary: !args.includes('--no-openlibrary'),
};

extractGenres(options)
  .catch(console.error)
  .finally(() => prisma.$disconnect());
