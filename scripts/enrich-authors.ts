/**
 * Enrich authors with OpenLibrary data
 * Fetches bios, photos, birth/death dates by searching OpenLibrary for author names
 *
 * Usage:
 *   npx tsx scripts/enrich-authors.ts          # Process all pending authors
 *   npx tsx scripts/enrich-authors.ts --dry    # Dry run (no database writes)
 *   npx tsx scripts/enrich-authors.ts --limit 50   # Process only 50 authors
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { getAuthor, extractDescription, getAuthorPhotoUrl } from '../src/lib/openlibrary';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log: ['error'],
  });
}

const prisma = globalForPrisma.prisma ?? createPrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

interface Options {
  dryRun?: boolean;
  limit?: number;
}

interface OpenLibrarySearchResult {
  key: string; // /authors/OL12345A
  name: string;
  birth_date?: string;
  death_date?: string;
  top_work?: string;
}

async function searchAuthorByName(name: string): Promise<OpenLibrarySearchResult | null> {
  const encodedName = encodeURIComponent(name);
  const url = `https://openlibrary.org/search.json?author=${encodedName}&limit=5`;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    if (!data.docs || data.docs.length === 0) return null;

    // Find best match - first result is usually best
    const result = data.docs[0];

    // Extract author key from the key field
    let authorKey: string | null = null;
    if (result.key && result.key.includes('/authors/')) {
      authorKey = result.key;
    } else if (result.author_key && result.author_key.length > 0) {
      authorKey = `/authors/${result.author_key[0]}`;
    }

    if (!authorKey) return null;

    return {
      key: authorKey,
      name: result.author_name?.[0] || name,
      birth_date: result.birth_date,
      death_date: result.death_date,
      top_work: result.top_work,
    };
  } catch (error) {
    console.error(`Error searching for author "${name}":`, error);
    return null;
  }
}

async function enrichAuthors(options: Options = {}) {
  const { dryRun = false, limit } = options;

  console.log(`🔍 Enriching authors from OpenLibrary...`);
  console.log(`   Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);

  // Find authors who haven't been enriched yet
  const authorsToEnrich = await prisma.author.findMany({
    where: {
      enrichedAt: null,
    },
    take: limit || 200,
  });

  console.log(`   Authors pending enrichment: ${authorsToEnrich.length}`);

  if (authorsToEnrich.length === 0) {
    const allAuthors = await prisma.author.count();
    const enrichedAuthors = await prisma.author.count({
      where: { enrichedAt: { not: null } },
    });
    console.log(`   Total authors: ${allAuthors}`);
    console.log(`   Already enriched: ${enrichedAuthors}`);
    console.log('✅ All authors are enriched!');
    return;
  }

  let processed = 0;
  let enriched = 0;
  let notFound = 0;
  let failed = 0;

  for (const author of authorsToEnrich) {
    processed++;
    console.log(`\n[${processed}/${authorsToEnrich.length}] ${author.name}`);

    try {
      // Search for author by name
      const olAuthorInfo = await searchAuthorByName(author.name);

      if (olAuthorInfo) {
        // Extract OpenLibrary ID from key
        const openLibraryId = olAuthorInfo.key.replace('/authors/', '');

        // Fetch full author details
        const olAuthor = await getAuthor(openLibraryId);

        if (olAuthor) {
          const bio = extractDescription(olAuthor.bio);
          const photoId = olAuthor.photos?.[0];
          const photoUrl = photoId ? getAuthorPhotoUrl(photoId, 'L') : null;

          const updates: any = {
            openLibraryId,
            enrichedAt: new Date(),
          };

          // Update bio if available
          if (bio && !author.bio) {
            updates.bio = bio;
          }

          // Update photo if available
          if (photoUrl && !author.photoUrl) {
            updates.photoUrl = photoUrl;
          }

          // Parse birth/death dates
          if (olAuthor.birth_date) {
            updates.birthDate = parseDate(olAuthor.birth_date);
          }
          if (olAuthor.death_date) {
            updates.deathDate = parseDate(olAuthor.death_date);
          }

          if (!dryRun) {
            await prisma.author.update({
              where: { id: author.id },
              data: updates,
            });
          }

          enriched++;
          console.log(`   ✓ Found: OLID=${openLibraryId}, bio=${bio ? 'yes' : 'no'}, photo=${photoUrl ? 'yes' : 'no'}`);
        } else {
          // Still save the ID even if we couldn't get details
          if (!dryRun && !author.openLibraryId) {
            await prisma.author.update({
              where: { id: author.id },
              data: {
                openLibraryId: olAuthorInfo.key.replace('/authors/', ''),
                enrichedAt: new Date(),
              },
            });
          }
          notFound++;
          console.log(`   ⚠️ ID found but details not available`);
        }
      } else {
        if (!dryRun) {
          await prisma.author.update({
            where: { id: author.id },
            data: { enrichedAt: new Date() },
          });
        }
        notFound++;
        console.log(`   ✗ Not found in OpenLibrary`);
      }
    } catch (error) {
      if (!dryRun) {
        await prisma.author.update({
          where: { id: author.id },
          data: { enrichedAt: new Date() },
        });
      }
      failed++;
      console.error(`   ! Error:`, error instanceof Error ? error.message : 'Unknown error');
    }

    // Progress percentage
    const pct = Math.round((processed / authorsToEnrich.length) * 100);
    process.stdout.write(`   Progress: ${pct}%\r`);
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 Summary:');
  console.log(`   Processed: ${processed}`);
  console.log(`   Enriched: ${enriched}`);
  console.log(`   Not Found: ${notFound}`);
  console.log(`   Failed: ${failed}`);
  console.log('='.repeat(50));

  if (dryRun) {
    console.log('\n⚠️  This was a dry run. Run without --dry to apply changes.');
  } else {
    console.log('\n✅ Author enrichment complete!');
  }
}

/**
 * Parse various date formats from OpenLibrary
 */
function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;

  // Try to extract year (most reliable)
  const yearMatch = dateStr.match(/\d{4}/);
  if (yearMatch) {
    return yearMatch[0];
  }

  // Return as-is if we can't parse
  return dateStr;
}

// Parse command line args
const args = process.argv.slice(2);
const options: Options = {
  dryRun: args.includes('--dry') || args.includes('-d'),
  limit: args.includes('--limit')
    ? parseInt(args[args.indexOf('--limit') + 1], 10)
    : undefined,
};

enrichAuthors(options).catch(console.error);