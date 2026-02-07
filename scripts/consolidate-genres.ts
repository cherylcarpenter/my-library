/**
 * Consolidate similar genres
 * Run with: npx tsx scripts/consolidate-genres.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Manual mappings for known similar genres
const MANUAL_MAPPINGS: Record<string, string> = {
  // Sci-Fi variations
  'science fiction': 'science fiction',
  'sci-fi': 'science fiction',
  'sf': 'science fiction',
  'scifi': 'science fiction',
  'sci fi': 'science fiction',
  'hard science fiction': 'science fiction',
  'soft science fiction': 'science fiction',
  'space opera': 'science fiction',
  
  // Fantasy variations
  'fantasy': 'fantasy',
  'epic fantasy': 'fantasy',
  'high fantasy': 'fantasy',
  'urban fantasy': 'fantasy',
  
  // Mystery/Thriller
  'mystery, thriller & suspense': 'thriller',
  'mystery, thriller and suspense': 'thriller',
  'thriller': 'thriller',
  'thrillers': 'thriller',
  'mystery': 'mystery',
  'mysteries': 'mystery',
  'suspense': 'thriller',
  
  // Horror
  'horror': 'horror',
  'horror fiction': 'horror',
  'gothic horror': 'horror',
  
  // Romance
  'romance': 'romance',
  'romance fiction': 'romance',
  'contemporary romance': 'romance',
  'romantic': 'romance',
  
  // Literary Fiction
  'literary fiction': 'literary fiction',
  'literary': 'literary fiction',
  'literature': 'literary fiction',
  
  // Classics
  'classics': 'classics',
  'classic': 'classics',
  'classic fiction': 'classics',
  
  // Non-fiction
  'non-fiction': 'nonfiction',
  'nonfiction': 'nonfiction',
  'non fiction': 'nonfiction',
  
  // Historical
  'historical fiction': 'historical fiction',
  'historical': 'historical fiction',
  
  // Young Adult
  'teen & young adult': 'young adult',
  'young adult': 'young adult',
  'ya': 'young adult',
  'teen': 'young adult',
  
  // Action & Adventure
  'action & adventure': 'action & adventure',
  'action and adventure': 'action & adventure',
  'adventure': 'action & adventure',
  
  // Coming of Age
  'coming of age': 'coming of age',
  'coming-of-age': 'coming of age',
  
  // Women/Family
  'womens fiction': "women's fiction",
  'women fiction': "women's fiction",
  'family life': 'family',
  'family saga': 'family',
};

function normalizeForComparison(name: string): string {
  return name
    .toLowerCase()
    .replace(/[&,\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+'/g, "'")
    .trim();
}

function getCanonicalName(name: string): string {
  const normalized = normalizeForComparison(name);
  
  // Check manual mappings
  if (MANUAL_MAPPINGS[normalized]) {
    return MANUAL_MAPPINGS[normalized];
  }
  
  // Auto-consolidate: lowercase version is the canonical form
  return name.toLowerCase();
}

async function consolidateGenres() {
  console.log('🔄 Consolidating genres...\n');
  
  // Get all genres
  const genres = await prisma.genre.findMany({
    orderBy: { bookCount: 'desc' }
  });
  
  console.log(`Found ${genres.length} genres to consolidate\n`);
  
  // Group by canonical name
  const canonicalGroups: Map<string, { id: string; name: string; bookCount: number }[]> = new Map();
  
  for (const genre of genres) {
    const canonical = getCanonicalName(genre.name);
    if (!canonicalGroups.has(canonical)) {
      canonicalGroups.set(canonical, []);
    }
    canonicalGroups.get(canonical)!.push({
      id: genre.id,
      name: genre.name,
      bookCount: genre.bookCount
    });
  }
  
  // Show groups with duplicates
  const duplicates = Array.from(canonicalGroups.entries())
    .filter(([_, variants]) => variants.length > 1)
    .sort((a, b) => b[1].length - a[1].length);
  
  console.log(`Groups with duplicates: ${duplicates.length}\n`);
  
  if (duplicates.length > 0) {
    console.log('Top duplicate groups:');
    for (const [canonical, variants] of duplicates.slice(0, 20)) {
      const totalBooks = variants.reduce((sum, v) => sum + v.bookCount, 0);
      console.log(`\n  "${canonical}" (${totalBooks} books):`);
      for (const v of variants) {
        console.log(`    - "${v.name}" (${v.bookCount} books)`);
      }
    }
  }
  
  // Consolidate
  console.log('\n\n🔄 Consolidating...\n');
  
  let consolidated = 0;
  let linksUpdated = 0;
  
  for (const [canonical, variants] of canonicalGroups) {
    if (variants.length <= 1) continue;
    
    // Pick the one with most books as the canonical
    const primary = variants.sort((a, b) => b.bookCount - a.bookCount)[0];
    const others = variants.slice(1);
    
    // Update all book-genre links to use primary
    for (const other of others) {
      // Move book links from other genre to primary
      const links = await prisma.bookGenre.findMany({
        where: { genreId: other.id }
      });
      
      for (const link of links) {
        // Delete old link first (using compound unique key)
        await prisma.bookGenre.delete({
          where: {
            bookId_genreId: {
              bookId: link.bookId,
              genreId: other.id
            }
          }
        });
        
        // Create new link with primary genre
        await prisma.bookGenre.upsert({
          where: {
            bookId_genreId: {
              bookId: link.bookId,
              genreId: primary.id
            }
          },
          create: {
            bookId: link.bookId,
            genreId: primary.id,
            source: link.source
          },
          update: {}
        });
        
        linksUpdated++;
      }
      
      // Delete the duplicate genre
      await prisma.genre.delete({
        where: { id: other.id }
      });
      
      consolidated++;
    }
  }
  
  console.log(`Consolidated ${consolidated} duplicate genres`);
  console.log(`Updated ${linksUpdated} book-genre links`);
  
  // Update book counts
  await prisma.$queryRaw`
    UPDATE "Genre" g
    SET "bookCount" = (
      SELECT COUNT(*) FROM "BookGenre" bg WHERE bg."genreId" = g.id
    )
  `;
  
  // Get final stats
  const finalGenres = await prisma.genre.count();
  const finalLinks = await prisma.bookGenre.count();
  const booksWithGenres = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT "bookId") as count FROM "BookGenre"
  ` as { count: string }[];
  
  console.log('\n📊 Final Stats:');
  console.log(`   Total genres: ${finalGenres}`);
  console.log(`   Book-genre links: ${finalLinks}`);
  console.log(`   Books with genres: ${booksWithGenres[0]?.count || 0}`);
  
  // Show top genres
  const topGenres = await prisma.genre.findMany({
    orderBy: { bookCount: 'desc' },
    take: 15
  });
  
  console.log('\nTop 15 genres:');
  for (const g of topGenres) {
    console.log(`   - ${g.name}: ${g.bookCount}`);
  }
  
  console.log('\n✅ Consolidation complete!');
}

consolidateGenres()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
