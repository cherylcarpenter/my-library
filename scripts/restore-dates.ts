import { Pool } from 'pg';
import 'dotenv/config';
import fs from 'fs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const oldData = JSON.parse(fs.readFileSync('/Users/cherylcarpenter/clawd/brain/projects/my-library/goodreads-library.json', 'utf-8'));
  
  const library = await pool.query(`
    SELECT l.id FROM "Library" l
    JOIN "User" u ON l."userId" = u.id
    WHERE u.email = 'cherylcarpenter2015@gmail.com'
    LIMIT 1
  `);
  const libraryId = library.rows[0].id;

  let restored = 0;
  for (const book of oldData.books) {
    if (book.dateRead) {
      const result = await pool.query(`
        UPDATE "UserBook" ub
        SET "dateRead" = $1::timestamp
        FROM "Book" b
        WHERE b.id = ub."bookId"
        AND ub."libraryId" = $2
        AND b."goodreadsId" = $3
      `, [book.dateRead, libraryId, book.bookId]);
      if (result.rowCount > 0) restored++;
    }
  }

  console.log('✅ Restored dateRead for', restored, 'books');

  // Verify Escape!
  const escape = await pool.query(`
    SELECT b.title, ub.shelf, ub."dateRead"
    FROM "Book" b
    JOIN "UserBook" ub ON b.id = ub."bookId"
    WHERE b.title LIKE 'Escape!%'
  `);
  console.log('Escape!:', escape.rows[0]);

  await pool.end();
}

main().catch(e => { console.error(e); pool.end(); });
