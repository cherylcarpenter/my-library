import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

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
    console.log(`  Checking: ${url.substring(0, 80)}...`);
    const validation = await validateCoverUrl(url);
    if (validation?.valid) {
      console.log(`    ✓ Valid cover: ${validation.width}x${validation.height}, ${(validation.fileSize/1024).toFixed(0)}KB`);
      return url;
    }
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

async function main() {
  const book = await pool.query(`
    SELECT b.id, b.title, b.isbn, b.isbn13, b.description, ba.name as authorName
    FROM "Book" b
    LEFT JOIN "BookAuthor" ba2 ON b.id = ba2."bookId"
    LEFT JOIN "Author" ba ON ba2."authorId" = ba.id
    WHERE b.title LIKE 'Escape!%'
  `);
  
  const row = book.rows[0];
  const authorName = row.authorName || 'Stephen Fishbach';
  const isbn = row.isbn13?.replace(/^=/, '') || row.isbn?.replace(/^=/, '') || null;
  
  console.log(`Enriching: ${row.title}`);
  console.log(`Author: ${authorName}`);
  console.log(`ISBN: ${isbn}`);
  console.log('');
  
  // Try OpenLibrary first
  console.log('→ Trying OpenLibrary...');
  const olCover = await getOpenLibraryCover(row.title, authorName, isbn);
  
  if (olCover) {
    console.log(`  ✓ OL cover found`);
    await pool.query(`
      UPDATE "Book" SET "coverUrl" = $1, "enrichmentStatus" = 'ENRICHED' WHERE id = $2
    `, [olCover, row.id]);
  } else {
    console.log('  ✗ No OL cover');
    
    // Fall back to Google Books
    console.log('→ Trying Google Books...');
    const gbCover = await getGoogleBooksCover(row.title, authorName, isbn);
    
    if (gbCover) {
      console.log(`  ✓ GB cover found`);
      await pool.query(`
        UPDATE "Book" SET "coverUrl" = $1, "enrichmentStatus" = 'ENRICHED' WHERE id = $2
      `, [gbCover, row.id]);
    } else {
      console.log('  ✗ No GB cover');
      // Set enriched anyway since the book is new
      await pool.query(`
        UPDATE "Book" SET "enrichmentStatus" = 'ENRICHED' WHERE id = $1
      `, [row.id]);
    }
  }
  
  // Check result
  console.log('');
  console.log('Result:');
  const result = await pool.query(`
    SELECT title, "enrichmentStatus", "coverUrl" FROM "Book" WHERE id = $1
  `, [row.id]);
  console.log(result.rows[0]);
  
  await pool.end();
}

main().catch(e => { console.error(e); pool.end(); });
