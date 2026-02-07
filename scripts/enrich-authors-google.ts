/**
 * Google Books-only Author Enrichment (Faster)
 * Run with: npx tsx scripts/enrich-authors-google.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as googlebooks from '../src/lib/googlebooks';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  console.log('=== Google Books Author Enrichment (Fast) ===\n');
  
  // Find authors missing bios or photos
  const authors = await prisma.author.findMany({
    where: {
      OR: [{ bio: null }, { photoUrl: null }]
    },
    include: {
      books: {
        include: {
          book: { select: { isbn: true, title: true } }
        },
        take: 3
      }
    },
    take: 500
  });
  
  console.log(`Found ${authors.length} authors needing enrichment\n`);
  
  let processed = 0;
  let updated = 0;
  
  for (const author of authors) {
    processed++;
    const authorName = author.name;
    
    // Find book with ISBN
    const bookWithIsbn = author.books.find(ba => ba.book.isbn);
    
    if (!bookWithIsbn) {
      console.log(`[${processed}/${authors.length}] ${authorName} - no ISBN`);
      continue;
    }
    
    console.log(`[${processed}/${authors.length}] ${authorName}`);
    
    // Search Google Books by ISBN
    const gbData = await googlebooks.searchByISBN(bookWithIsbn.book.isbn!);
    
    if (gbData) {
      // Check if author matches
      const gbAuthors = gbData.authors || [];
      const match = gbAuthors.some((a: string) => 
        a.toLowerCase().includes(authorName.toLowerCase().split(' ').pop() || '')
      );
      
      if (match) {
        const gbCover = googlebooks.getCoverUrl(gbData.imageLinks?.thumbnail);
        const gbDesc = gbData.description;
        
        const updateData: any = {};
        if (gbCover && !author.photoUrl) updateData.photoUrl = gbCover;
        if (gbDesc && !author.bio) updateData.bio = gbDesc;
        
        if (Object.keys(updateData).length > 0) {
          await prisma.author.update({
            where: { id: author.id },
            data: updateData
          });
          console.log(`  ✓ Updated: cover=${!!gbCover}, bio=${!!gbDesc}`);
          updated++;
        } else {
          console.log(`  - Already has data`);
        }
      } else {
        console.log(`  - Author mismatch`);
      }
    } else {
      console.log(`  - No GB data`);
    }
    
    await delay(100); // Rate limit
  }
  
  console.log(`\n=== Summary ===`);
  console.log(`Processed: ${processed}`);
  console.log(`Updated: ${updated}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
