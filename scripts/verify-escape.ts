import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Check Escape!
  const escape = await pool.query(`
    SELECT b.title, ub.shelf, ub."dateRead"
    FROM "Book" b
    JOIN "UserBook" ub ON b.id = ub."bookId"
    JOIN "Library" l ON ub."libraryId" = l.id
    JOIN "User" u ON l."userId" = u.id
    WHERE u.email = 'cherylcarpenter2015@gmail.com'
    AND b.title LIKE 'Escape!%'
  `);
  console.log('Escape!:', escape.rows[0]);

  // Check recently read
  const recent = await pool.query(`
    SELECT b.title, ub.shelf, ub."dateRead"
    FROM "Book" b
    JOIN "UserBook" ub ON b.id = ub."bookId"
    JOIN "Library" l ON ub."libraryId" = l.id
    JOIN "User" u ON l."userId" = u.id
    WHERE u.email = 'cherylcarpenter2015@gmail.com'
    AND ub."dateRead" IS NOT NULL
    ORDER BY ub."dateRead" DESC
    LIMIT 10
  `);
  console.log('\nRecently Read:');
  recent.rows.forEach(r => {
    const date = r.dateRead ? r.dateRead.toISOString().split('T')[0] : 'null';
    console.log('  ', date, r.title.substring(0,50), '|', r.shelf);
  });

  await pool.end();
}

main().catch(e => { console.error(e); pool.end(); });
