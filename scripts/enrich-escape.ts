import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const book = await pool.query(`
    SELECT b.id, b.isbn, b.isbn13, b.title
    FROM "Book" b
    WHERE b.title LIKE 'Escape!%'
  `);
  
  const row = book.rows[0];
  const isbn = row.isbn13?.replace(/^=/, '') || row.isbn?.replace(/^=/, '');
  console.log('ISBN:', isbn);
  
  try {
    // Try OpenLibrary
    const olRes = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
    if (olRes.ok) {
      const data = await olRes.json();
      console.log('OpenLibrary found:', data.covers);
      
      if (data.covers?.[0]) {
        const coverUrl = `https://covers.openlibrary.org/b/id/${data.covers[0]}-L.jpg`;
        await pool.query(`
          UPDATE "Book" SET "coverUrl" = $1, "enrichmentStatus" = 'ENRICHED' WHERE id = $2
        `, [coverUrl, row.id]);
        console.log('✅ Cover set:', coverUrl);
      }
    } else {
      console.log('OpenLibrary not found, trying Google Books...');
      
      // Try Google Books
      const gbRes = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
      const gbData = await gbRes.json();
      
      if (gbData.items?.[0]?.volumeInfo?.imageLinks?.thumbnail) {
        const coverUrl = gbData.items[0].volumeInfo.imageLinks.thumbnail;
        await pool.query(`
          UPDATE "Book" SET "coverUrl" = $1, "enrichmentStatus" = 'ENRICHED' WHERE id = $2
        `, [coverUrl, row.id]);
        console.log('✅ Google Books cover set:', coverUrl);
      }
    }
  } catch (e) {
    console.log('Error:', e);
  }
  
  // Check result
  const updated = await pool.query(`
    SELECT title, "enrichmentStatus", "coverUrl" FROM "Book" WHERE id = $1
  `, [row.id]);
  console.log('Result:', updated.rows[0]);
  
  await pool.end();
}

main().catch(e => { console.error(e); pool.end(); });
