/**
 * Author Bio Enrichment with Google Books fallback
 * Run with: npx tsx scripts/enrich-authors-combined.ts
 * 
 * Options:
 *   --dry-run     Preview only, don't save
 *   --approve     Auto-approve
 *   --limit N     Process only N authors
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as openlibrary from '../src/lib/openlibrary';
import * as googlebooks from '../src/lib/googlebooks';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface Args {
  dryRun?: boolean;
  approve?: boolean;
  limit?: number;
}

async function getArgs(): Promise<Args> {
  const args: Args = {};
  if (process.argv.includes('--dry-run')) args.dryRun = true;
  if (process.argv.includes('--approve')) args.approve = true;
  
  const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
  if (limitArg) args.limit = parseInt(limitArg.split('=')[1]);
  
  return args;
}

async function enrichAuthor(
  author: any,
  dryRun: boolean,
  autoApprove: boolean
): Promise<{ updated: boolean; photo?: boolean; bio?: boolean }> {
  const authorName = author.name;
  const books = author.books || [];
  
  // Find book with ISBN for Google Books lookup
  const bookWithIsbn = books.find((ba: any) => ba.book.isbn);
  
  let result = { updated: false, photo: false, bio: false };
  
  // Try Google Books first (often has better author data)
  if (bookWithIsbn) {
    const gbData = await googlebooks.searchByISBN(bookWithIsbn.book.isbn);
    
    if (gbData) {
      const gbAuthors = gbData.authors || [];
      const match = gbAuthors.some((a: string) => 
        a.toLowerCase().includes(authorName.toLowerCase().split(' ').pop() || '')
      );
      
      if (match) {
        const gbCover = googlebooks.getCoverUrl(gbData.imageLinks?.thumbnail);
        const gbDesc = gbData.description;
        
        if (dryRun) {
          console.log(`  [GB] ${authorName} - cover: ${!!gbCover}, desc: ${!!gbDesc}`);
        } else {
          const updateData: any = {};
          if (gbCover && (!author.photoUrl || autoApprove)) {
            updateData.photoUrl = gbCover;
            result.photo = true;
          }
          if (gbDesc && !author.bio) {
            updateData.bio = gbDesc;
            result.bio = true;
          }
          
          if (Object.keys(updateData).length > 0) {
            await prisma.author.update({
              where: { id: author.id },
              data: {
                ...updateData,
                enrichedAt: new Date()
              }
            });
            result.updated = true;
          }
        }
      }
    }
  }
  
  // Try OpenLibrary as backup
  if (!result.updated || !result.photo) {
    // Find OL author ID from books
    const bookWithOlid = books.find((ba: any) => ba.book.openLibraryId);
    
    if (bookWithOlid) {
      try {
        const bookData = await fetch(
          `https://openlibrary.org/works/${bookWithOlid.book.openLibraryId}.json`
        ).then(r => r.json());
        
        if (bookData.authors && bookData.authors.length > 0) {
          const authorRef = bookData.authors[0];
          const olAuthorId = typeof authorRef === 'string'
            ? authorRef.replace('/authors/', '')
            : authorRef.key?.replace('/authors/', '');
          
          if (olAuthorId) {
            const olData = await openlibrary.getAuthor(olAuthorId);
            
            if (olData) {
              const olBio = openlibrary.extractDescription(olData.bio);
              const olPhoto = olData.photos?.[0];
              
              if (dryRun) {
                console.log(`  [OL] ${authorName} - cover: ${!!olPhoto}, bio: ${!!olBio}`);
              } else {
                const updateData: any = {};
                if (olPhoto && (!author.photoUrl || autoApprove)) {
                  updateData.photoUrl = `https://covers.openlibrary.org/a/id/${olPhoto}-L.jpg`;
                  result.photo = true;
                }
                if (olBio && !author.bio) {
                  updateData.bio = olBio;
                  result.bio = true;
                }
                
                if (Object.keys(updateData).length > 0) {
                  await prisma.author.update({
                    where: { id: author.id },
                    data: {
                      ...updateData,
                      openLibraryId: olAuthorId,
                      enrichedAt: new Date()
                    }
                  });
                  result.updated = true;
                }
              }
            }
          }
        }
      } catch (error) {
        console.error(`  Error fetching OL data for ${authorName}:`, error);
      }
    }
  }
  
  return result;
}

async function main() {
  const args = await getArgs();
  const dryRun = args.dryRun || false;
  const autoApprove = args.approve || false;
  const limit = args.limit || Infinity;
  
  console.log('=== Combined Author Enrichment ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : autoApprove ? 'AUTO-APPROVE' : 'MANUAL APPROVAL'}`);
  if (limit !== Infinity) console.log(`Limit: ${limit} authors\n`);
  
  const authors = await prisma.author.findMany({
    where: {
      OR: [
        { bio: null },
        { photoUrl: null }
      ]
    },
    include: {
      books: {
        include: {
          book: {
            select: { isbn: true, openLibraryId: true, title: true }
          }
        }
      }
    },
    take: typeof limit === 'number' && limit < Infinity ? limit : 1000
  });
  
  console.log(`Found ${authors.length} authors needing enrichment\n`);
  
  let processed = 0;
  let updated = 0;
  
  for (const author of authors) {
    processed++;
    console.log(`[${processed}/${authors.length}] ${author.name}`);
    
    const result = await enrichAuthor(author, dryRun, autoApprove);
    
    if (result.updated) {
      updated++;
      console.log(`  ✓ Updated: photo=${result.photo}, bio=${result.bio}`);
    } else {
      console.log(`  - No update`);
    }
    
    await delay(100);
  }
  
  console.log(`\n=== Summary ===`);
  console.log(`Processed: ${processed}`);
  console.log(`Updated: ${updated}`);
  
  if (dryRun) {
    console.log('\n[DRY RUN] No changes were made.');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
