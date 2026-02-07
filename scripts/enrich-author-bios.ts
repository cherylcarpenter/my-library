/**
 * Enrich authors with bios and photos from OpenLibrary
 * Run with: npx tsx scripts/enrich-author-bios.ts
 * 
 * Strategy:
 * 1. Find authors who don't have bios
 * 2. Check if any of their books have OpenLibrary IDs
 * 3. Use book OLIDs to find author OLIDs on OpenLibrary
 * 4. Fetch author details and update
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { getAuthor, extractDescription } from '../src/lib/openlibrary';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// Rate limit: 600ms between requests (~100/min)
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function getBooksForAuthor(authorId: string) {
  return prisma.bookAuthor.findMany({
    where: { authorId },
    include: {
      book: {
        select: { openLibraryId: true, title: true }
      }
    }
  });
}

async function enrichAuthorBio(author: any): Promise<boolean> {
  // First, check if author already has an OpenLibrary ID
  let authorOlid = author.openLibraryId;

  // If not, try to find it from their books
  if (!authorOlid) {
    const bookAuthors = await getBooksForAuthor(author.id);
    const bookWithOlid = bookAuthors.find(ba => ba.book.openLibraryId);
    
    if (bookWithOlid) {
      // Try to fetch author OLID from book data
      try {
        const bookData = await fetch(
          `https://openlibrary.org/works/${bookWithOlid.book.openLibraryId}.json`
        ).then(r => r.json());

        if (bookData.authors && bookData.authors.length > 0) {
          const authorRef = bookData.authors[0];
          authorOlid = typeof authorRef === 'string' 
            ? authorRef.replace('/authors/', '')
            : authorRef.key?.replace('/authors/', '');
        }
      } catch (error) {
        console.error(`Error fetching book data for ${bookWithOlid.book.title}:`, error);
      }
    }
  }

  if (!authorOlid) {
    return false;
  }

  // Fetch author details from OpenLibrary
  try {
    const authorData = await getAuthor(authorOlid);
    
    if (authorData) {
      const bio = extractDescription(authorData.bio);
      const photoId = authorData.photos?.[0];

      await prisma.author.update({
        where: { id: author.id },
        data: {
          bio: bio || undefined,
          photoUrl: photoId 
            ? `https://covers.openlibrary.org/a/id/${photoId}-L.jpg`
            : undefined,
          birthDate: authorData.birth_date || undefined,
          deathDate: authorData.death_date || undefined,
          openLibraryId: authorOlid,
          enrichedAt: new Date()
        }
      });

      console.log(`✓ Enriched: ${author.name} (${authorOlid}) - bio: ${bio ? 'yes' : 'no'}, photo: ${photoId ? 'yes' : 'no'}`);
      return true;
    }
  } catch (error) {
    console.error(`✗ Error enriching author ${author.id}:`, error);
  }

  return false;
}

async function main() {
  console.log('=== Author Bio Enrichment ===\n');

  // Count authors
  const totalAuthors = await prisma.author.count();
  const withBio = await prisma.author.count({ where: { bio: { not: null } } });
  const withoutBio = await prisma.author.count({ where: { bio: null } });

  console.log(`Total authors: ${totalAuthors}`);
  console.log(`With bios: ${withBio}`);
  console.log(`Without bios: ${withoutBio}\n`);

  // Find authors without bios but with potential (they have books)
  const authorsToEnrich = await prisma.author.findMany({
    where: {
      bio: null
    },
    include: {
      books: {
        select: { book: { select: { openLibraryId: true, title: true } } },
        take: 5
      }
    },
    take: 100 // Start with 100 for testing
  });

  console.log(`Processing ${authorsToEnrich.length} authors...\n`);

  let enriched = 0;
  let skipped = 0;

  for (const author of authorsToEnrich) {
    // Check if any book has an OpenLibrary ID OR if author has their own OLID
    const hasOlidBook = author.books.some(b => b.book.openLibraryId);
    const hasAuthorOlid = !!author.openLibraryId;

    if (!hasOlidBook && !hasAuthorOlid) {
      skipped++;
      continue;
    }

    const success = await enrichAuthorBio(author);
    if (success) enriched++;
    
    await delay(600); // Rate limit
  }

  console.log('\n=== Summary ===');
  console.log(`Enriched: ${enriched}`);
  console.log(`Skipped (no OL books): ${skipped}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
