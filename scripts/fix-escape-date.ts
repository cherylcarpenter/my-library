import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

async function main() {
  // Update Escape! to have T00:00:00.000Z (same as other 2026 books)
  await pool.query(`
    UPDATE "UserBook" ub
    SET "dateRead" = '2026-02-04T00:00:00.000Z'::timestamp
    FROM "Book" b
    WHERE b.id = ub."bookId"
    AND b.title = 'Escape!'
  `);
  console.log('✅ Updated Escape! dateRead to 2026-02-04T00:00:00.000Z');

  // Verify
  const result = await pool.query(`
    SELECT b.title, ub."dateRead"
    FROM "Book" b
    JOIN "UserBook" ub ON b.id = ub."bookId"
    WHERE b.title = 'Escape!'
  `);
  console.log('Result:', result.rows[0]);

  await pool.end();
}

main().catch(e => { console.error(e); pool.end(); });
