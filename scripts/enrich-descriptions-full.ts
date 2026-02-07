/**
 * Run description enrichment continuously until 90% coverage
 * Run with: npx tsx scripts/enrich-descriptions-full.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const DELAY_MS = 600;
const BATCH_SIZE = 100;
const GOAL_PERCENTAGE = 90;

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

async function getCurrentStats() {
  const total = await prisma.book.count();
  const withDesc = await prisma.book.count({ 
    where: { description: { not: null } } 
  });
  return { total, withDesc, percentage: (withDesc / total) * 100 };
}

async function enrichBatch(offset: number): Promise<{ found: number; notFound: number; done: boolean }> {
  const booksWithoutDesc = await prisma.book.findMany({
    where: {
      OR: [
        { description: null },
        { description: '' }
      ],
      enrichmentStatus: { not: 'NOT_FOUND' }
    },
    include: {
      authors: {
        include: {
          author: { select: { name: true } }
        },
        take: 2
      }
    },
    skip: offset,
    take: BATCH_SIZE
  });

  if (booksWithoutDesc.length === 0) {
    return { found: 0, notFound: 0, done: true };
  }

  let found = 0;
  let notFound = 0;

  for (const book of booksWithoutDesc) {
    try {
      const authorName = book.authors[0]?.author?.name;
      const searchUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(book.title)}${authorName ? `&author=${encodeURIComponent(authorName)}` : ''}&limit=1`;
      
      const searchRes = await fetch(searchUrl);
      if (!searchRes.ok) throw new Error('Search failed');
      
      const searchData = await searchRes.json();
      const workKey = searchData.docs?.[0]?.key;

      if (!workKey) {
        await prisma.book.update({
          where: { id: book.id },
          data: { enrichmentStatus: 'NOT_FOUND' }
        });
        notFound++;
        await delay(DELAY_MS);
        continue;
      }

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
        found++;
      } else {
        await prisma.book.update({
          where: { id: book.id },
          data: { enrichmentStatus: 'PARTIAL' }
        });
        notFound++;
      }
    } catch (error) {
      console.error(`Error processing ${book.title}:`, error instanceof Error ? error.message : error);
      notFound++;
    }
    
    await delay(DELAY_MS);
  }

  return { found, notFound, done: false };
}

async function main() {
  console.log('🎯 Continuous Description Enrichment');
  console.log('Goal: 90% coverage\n');
  
  let totalFound = 0;
  let totalNotFound = 0;
  let batch = 0;
  let consecutiveEmpty = 0;
  
  while (true) {
    const stats = await getCurrentStats();
    console.log(`\n[${new Date().toLocaleTimeString()}]`);
    console.log(`   Total: ${stats.total}`);
    console.log(`   With descriptions: ${stats.withDesc}`);
    console.log(`   Coverage: ${stats.percentage.toFixed(1)}%`);
    
    if (stats.percentage >= GOAL_PERCENTAGE) {
      console.log(`\n🎉 SUCCESS! Reached ${stats.percentage.toFixed(1)}% coverage (goal: ${GOAL_PERCENTAGE}%)`);
      break;
    }
    
    batch++;
    console.log(`\n📦 Batch ${batch} starting...`);
    
    const result = await enrichBatch(batch * BATCH_SIZE);
    
    if (result.done) {
      consecutiveEmpty++;
      console.log(`   No more books to process (batch ${batch})`);
      if (consecutiveEmpty >= 3) {
        console.log(`\n⚠️  No more books found after 3 batches. Stopping.`);
        break;
      }
    } else {
      consecutiveEmpty = 0;
      totalFound += result.found;
      totalNotFound += result.notFound;
      console.log(`   Found: ${result.found} | Not found: ${result.notFound}`);
      console.log(`   Running total: ${totalFound} found, ${totalNotFound} not found`);
    }
  }
  
  console.log('\n========================================');
  console.log('FINAL STATUS');
  const finalStats = await getCurrentStats();
  console.log(`   Total books: ${finalStats.total}`);
  console.log(`   With descriptions: ${finalStats.withDesc}`);
  console.log(`   Coverage: ${finalStats.percentage.toFixed(1)}%`);
  console.log('========================================\n');
}

main()
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });