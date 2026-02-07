/**
 * Import book descriptions from CSV (proper CSV parsing)
 * Run: npx tsx scripts/import-descriptions.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as readline from 'readline';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const CSV_FILE = 'missing-descriptions-filled.csv';

interface BookRow {
  title: string;
  author: string;
  isbn: string;
  openLibraryId: string;
  url: string;
  description: string;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

async function main() {
  console.log('=== Importing Book Descriptions ===\n');
  
  if (!fs.existsSync(CSV_FILE)) {
    console.error(`File not found: ${CSV_FILE}`);
    return;
  }
  
  const fileStream = fs.createReadStream(CSV_FILE);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  
  let lineNum = 0;
  let booksWithDesc = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  
  for await (const line of rl) {
    lineNum++;
    
    // Skip header
    if (lineNum === 1) continue;
    
    const values = parseCSVLine(line);
    const title = values[0]?.replace(/^"|"$/g, '') || '';
    const author = values[1]?.replace(/^"|"$/g, '') || '';
    const isbn = values[2]?.replace(/^"|"$/g, '') || '';
    const description = values[5]?.replace(/^"|"$/g, '') || '';
    
    // Skip if no description or too short
    if (!description || description.length < 50) continue;
    
    booksWithDesc++;
    
    try {
      // Find book by ISBN
      let dbBook: any = null;
      
      if (isbn) {
        // Normalize ISBN (remove dashes, spaces)
        const normalizedIsbn = isbn.replace(/[-\s]/g, '');
        dbBook = await prisma.book.findFirst({
          where: {
            OR: [
              { isbn: normalizedIsbn },
              { isbn: isbn },
              { isbn: { contains: normalizedIsbn } }
            ]
          }
        });
      }
      
      // Try title match if ISBN didn't work
      if (!dbBook && title && title.length > 5) {
        dbBook = await prisma.book.findFirst({
          where: {
            title: { 
              equals: title,
              mode: 'insensitive'
            }
          }
        });
      }
      
      // Try partial title match
      if (!dbBook && title && title.length > 10) {
        dbBook = await prisma.book.findFirst({
          where: {
            title: { contains: title.substring(0, 30), mode: 'insensitive' }
          }
        });
      }
      
      if (dbBook && !dbBook.description) {
        await prisma.book.update({
          where: { id: dbBook.id },
          data: {
            description: description,
            enrichedAt: new Date(),
            enrichmentStatus: 'ENRICHED'
          }
        });
        updated++;
        if (updated <= 10) {
          console.log(`✓ ${title.substring(0, 45)}...`);
        }
      } else {
        skipped++;
      }
    } catch (e) {
      errors++;
      console.error(`✗ Error: ${title}`);
    }
  }
  
  console.log('\n=== Summary ===');
  console.log(`Books with descriptions (>=50 chars): ${booksWithDesc}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
  
  // Show new coverage
  const total = await prisma.book.count();
  const withDesc = await prisma.book.count({ where: { description: { not: null } } });
  console.log(`\nNew description coverage: ${withDesc}/${total} (${Math.round(withDesc/total*100)}%)`);
  
  await prisma.$disconnect();
}

main().catch(console.error);
