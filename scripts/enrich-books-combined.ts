/**
 * Combined Book Enrichment Script
 * Uses OpenLibrary + Google Books with author validation
 * Supports manual approval for mismatched covers
 * 
 * Run with: npx tsx scripts/enrich-books-combined.ts
 * 
 * Options:
 *   --dry-run     Preview only, don't save
 *   --approve     Auto-approve matches (default: prompts for manual approval)
 *   --limit N     Process only N books
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

// Track books needing manual approval
const pendingApprovals: Array<{
  bookId: string;
  title: string;
  currentCover: string | null;
  proposedCover: string;
  author: string;
  source: 'google' | 'openlibrary';
  confidence: number;
}> = [];

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
  if (limitArg) {
    args.limit = parseInt(limitArg.split('=')[1]);
  }
  
  return args;
}

async function enrichBook(
  book: any,
  dryRun: boolean,
  autoApprove: boolean
): Promise<{ updated: boolean; cover?: string; description?: string; skipReason?: string }> {
  type EnrichResult = { updated: boolean; cover?: string; description?: string; skipReason?: string };
  const isbn = book.isbn;
  const title = book.title;
  const authorName = book.authors?.[0]?.name || '';
  
  let result: EnrichResult = { updated: false };
  
  // Try OpenLibrary first
  let olData = null;
  if (isbn) {
    olData = await openlibrary.searchByISBN(isbn);
    if (olData) {
      const olCover = isbn ? openlibrary.getCoverUrl(isbn) : null;
      const olDesc = openlibrary.extractDescription(olData?.notes || olData?.description);
      
      // Validate author for OpenLibrary
      const olAuthors = olData?.authors || [];
      const olAuthorMatch = validateAuthor(authorName, olAuthors);
      
      if (olCover && olAuthorMatch.confidence >= 50) {
        if (dryRun) {
          console.log(`  [OL] ${title} - cover: ${olCover ? 'yes' : 'no'}, desc: ${olDesc ? 'yes' : 'no'}`);
        } else {
          // Check for cover mismatch
          if (book.coverUrl && book.coverUrl !== olCover && !autoApprove) {
            pendingApprovals.push({
              bookId: book.id,
              title,
              currentCover: book.coverUrl,
              proposedCover: olCover,
              author: authorName,
              source: 'openlibrary',
              confidence: olAuthorMatch.confidence
            });
          } else {
            await prisma.book.update({
              where: { id: book.id },
              data: {
                coverUrl: olCover,
                description: olDesc || undefined,
                openLibraryId: openlibrary.extractOpenLibraryId(olData) || undefined,
                enrichedAt: new Date(),
                enrichmentStatus: 'ENRICHED'
              }
            });
            result = { updated: true, cover: olCover, description: olDesc || undefined };
          }
        }
      }
    }
  }
  
  // Try Google Books as fallback or for additional data
  let gbData = null;
  const searchMethod = isbn 
    ? googlebooks.searchByISBN(isbn)
    : googlebooks.searchWithAuthorValidation(title, authorName);
  
  gbData = await searchMethod;
  
  if (gbData) {
    const gbCover = googlebooks.getCoverUrl(gbData.imageLinks?.thumbnail);
    const gbDesc = gbData.description;
    
    // Validate author for Google Books
    const gbAuthors = gbData.authors || [];
    const gbAuthorMatch = validateAuthor(authorName, gbAuthors);
    
    if (gbCover || gbDesc) {
      if (dryRun) {
        console.log(`  [GB] ${title} - cover: ${gbCover ? 'yes' : 'no'}, desc: ${gbDesc ? 'yes' : 'no'}`);
      } else if (!result.updated || !gbDesc) {
        // Only update if we don't have description yet
        if (!result.description && gbDesc && gbAuthorMatch.confidence >= 30) {
          if (gbCover && book.coverUrl && book.coverUrl !== gbCover && !autoApprove) {
            pendingApprovals.push({
              bookId: book.id,
              title,
              currentCover: book.coverUrl,
              proposedCover: gbCover,
              author: authorName,
              source: 'google',
              confidence: gbAuthorMatch.confidence
            });
          } else {
            await prisma.book.update({
              where: { id: book.id },
              data: {
                coverUrl: gbCover || book.coverUrl || undefined,
                description: gbDesc || book.description || undefined,
                enrichedAt: new Date(),
                enrichmentStatus: 'ENRICHED'
              }
            });
            result = { updated: true, cover: gbCover || undefined, description: gbDesc || undefined };
          }
        }
      }
    }
  }
  
  if (!olData && !gbData) {
    result = { updated: false, skipReason: 'No data found' };
  }
  
  return result;
}

function validateAuthor(
  targetAuthor: string,
  sourceAuthors: Array<{ name?: string; key?: string }>
): { confidence: number; match: boolean } {
  if (!targetAuthor || !sourceAuthors || sourceAuthors.length === 0) {
    return { confidence: 0, match: false };
  }
  
  const targetLower = targetAuthor.toLowerCase();
  const targetParts = targetLower.split(' ');
  const targetLastName = targetParts[targetParts.length - 1];
  
  for (const author of sourceAuthors) {
    const authorName = author.name || '';
    const authorLower = authorName.toLowerCase();
    const authorParts = authorLower.split(' ');
    const authorLastName = authorParts[authorParts.length - 1];
    
    // Exact match
    if (authorLower === targetLower) {
      return { confidence: 100, match: true };
    }
    
    // Last name + first initial match (e.g., "Smith, J." vs "John Smith")
    if (targetLastName && authorLastName === targetLastName) {
      // Check if first names might match
      const targetFirstName = targetParts[0];
      const authorFirstName = authorParts[0];
      if (targetFirstName && authorFirstName && 
          (targetFirstName === authorFirstName || 
           targetFirstName[0] === authorFirstName[0])) {
        return { confidence: 80, match: true };
      }
      return { confidence: 50, match: true };
    }
    
    // Partial match
    if (authorLower.includes(targetLower) || targetLower.includes(authorLower)) {
      return { confidence: 30, match: true };
    }
  }
  
  return { confidence: 0, match: false };
}

async function main() {
  const args = await getArgs();
  const dryRun = args.dryRun || false;
  const autoApprove = args.approve || false;
  const limit = args.limit || Infinity;
  
  console.log('=== Combined Book Enrichment ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : autoApprove ? 'AUTO-APPROVE' : 'MANUAL APPROVAL'}`);
  if (limit !== Infinity) console.log(`Limit: ${limit} books\n`);
  
  // Find books needing enrichment
  const books = await prisma.book.findMany({
    where: {
      OR: [
        { description: null },
        { enrichmentStatus: 'PENDING' },
        { enrichmentStatus: 'PARTIAL' }
      ]
    },
    include: {
      authors: {
        include: {
          author: { select: { name: true } }
        }
      }
    },
    take: limit
  });
  
  console.log(`Found ${books.length} books needing enrichment\n`);
  
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  
  for (const book of books) {
    processed++;
    const authorName = book.authors[0]?.author?.name || '';
    
    console.log(`[${processed}/${books.length}] ${book.title} by ${authorName}`);
    
    const result = await enrichBook(book, dryRun, autoApprove);
    
    if (result.updated) {
      updated++;
      console.log(`  ✓ Updated: cover=${!!result.cover}, desc=${!!result.description}`);
    } else if (result.skipReason) {
      skipped++;
      console.log(`  - Skipped: ${result.skipReason}`);
    }
    
    await delay(100); // Rate limit
  }
  
  console.log('\n=== Summary ===');
  console.log(`Processed: ${processed}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Pending approvals: ${pendingApprovals.length}`);
  
  if (pendingApprovals.length > 0 && !dryRun && !autoApprove) {
    console.log('\n=== Books Needing Manual Approval ===');
    for (const approval of pendingApprovals) {
      console.log(`\n📚 ${approval.title}`);
      console.log(`   Author: ${approval.author}`);
      console.log(`   Source: ${approval.source.toUpperCase()}`);
      console.log(`   Confidence: ${approval.confidence}%`);
      console.log(`   Current: ${approval.currentCover || 'none'}`);
      console.log(`   Proposed: ${approval.proposedCover}`);
      console.log(`   ID: ${approval.bookId}`);
    }
    
    console.log('\nTo approve all: npx tsx scripts/enrich-books-combined.ts --approve');
    console.log('To review individually, check pendingApprovals in the script output.');
  }
  
  if (dryRun) {
    console.log('\n[DRY RUN] No changes were made.');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
