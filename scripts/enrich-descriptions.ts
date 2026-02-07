/**
 * Enrich books with descriptions from OpenLibrary
 * Run with: npx tsx scripts/enrich-descriptions.ts
 * 
 * Strategy:
 * 1. Search by title+author to get OpenLibrary work ID
 * 2. Fetch work details for description
 * 3. Store description in database
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const DELAY_MS = 600;
const BATCH_SIZE = 100;

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Extract description from various OpenLibrary response formats
function extractDescription(description: any): string | null {
  if (!description) return null;
  if (typeof description === 'string') {
    return description.trim() || null;
  }
  if (typeof description === 'object' && description.value) {
    return description.value.trim() || null;
  }
  return null;
}

async function main() {
  console.log('📚 Finding books without descriptions...\n');
  
  // Find books that have been enriched (have OpenLibrary data) but no description
  const booksWithoutDesc = await prisma.book.findMany({
    where: {
      OR: [
        { description: null },
        { description: '' }
      ],
      enrichmentStatus: { not: 'NOT_FOUND' } // Skip books we know don't exist in OL
    },
    include: {
      authors: {
        include: {
          author: {
            select: { name: true }
          }
        },
        take: 2
      }
    },
    take: BATCH_SIZE
  });
  
  console.log(`Found ${booksWithoutDesc.length} books without descriptions\n`);
  
  let found = 0;
  let notFound = 0;
  let errors = 0;
  
  for (const book of booksWithoutDesc) {
    process.stdout.write(`[${found + notFound + 1}/${booksWithoutDesc.length}] ${book.title.substring(0, 40).padEnd(40)} `);
    
    try {
      const authorName = book.authors[0]?.author?.name;
      
      // Step 1: Search by title + author to get work ID
      const searchUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(book.title)}${authorName ? `&author=${encodeURIComponent(authorName)}` : ''}&limit=1`;
      
      const searchRes = await fetch(searchUrl);
      if (!searchRes.ok) throw new Error('Search failed');
      
      const searchData = await searchRes.json();
      const workKey = searchData.docs?.[0]?.key; // e.g., "/works/OL38501W"
      
      if (!workKey) {
        console.log('✗ Work not found');
        await prisma.book.update({
          where: { id: book.id },
          data: { enrichmentStatus: 'NOT_FOUND' }
        });
        notFound++;
        await delay(DELAY_MS);
        continue;
      }
      
      // Step 2: Fetch work details for description
      const workUrl = `https://openlibrary.org${workKey}.json`;
      const workRes = await fetch(workUrl);
      
      if (!workRes.ok) throw new Error('Work fetch failed');
      
      const workData = await workRes.json();
      const description = extractDescription(workData.description);
      
      if (description) {
        await prisma.book.update({
          where: { id: book.id },
          data: { 
            description,
            openLibraryKey: workKey.replace('/works/', ''),
            enrichedAt: new Date(),
            enrichmentStatus: 'ENRICHED'
          }
        });
        console.log('✓ Found');
        found++;
      } else {
        console.log('✗ No description in work');
        await prisma.book.update({
          where: { id: book.id },
          data: { enrichmentStatus: 'PARTIAL' }
        });
        notFound++;
      }
    } catch (error) {
      console.log('✗ Error');
      errors++;
      console.error('  ', error instanceof Error ? error.message : error);
    }
    
    await delay(DELAY_MS);
  }
  
  console.log(`\n📊 Results:`);
  console.log(`   Descriptions found: ${found}`);
  console.log(`   Not found: ${notFound}`);
  console.log(`   Errors: ${errors}`);
  
  // Show sample
  const sample = await prisma.book.findMany({
    where: {
      NOT: [
        { description: null },
        { description: '' }
      ]
    },
    select: { title: true, description: true },
    take: 5
  });
  
  if (sample.length > 0) {
    console.log('\n📖 Sample descriptions:');
    sample.forEach(b => {
      const desc = b.description?.substring(0, 120) + '...';
      console.log(`\n - ${b.title}`);
      console.log(`   "${desc}"`);
    });
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });