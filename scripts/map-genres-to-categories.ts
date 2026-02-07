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

// The 17 high-level categories
const CATEGORIES = [
  { name: 'Literary Fiction', slug: 'literary-fiction', sortOrder: 1 },
  { name: 'Mystery & Thriller', slug: 'mystery-thriller', sortOrder: 2 },
  { name: 'Science Fiction', slug: 'science-fiction', sortOrder: 3 },
  { name: 'Fantasy', slug: 'fantasy', sortOrder: 4 },
  { name: 'Paranormal', slug: 'paranormal', sortOrder: 5 },
  { name: 'Horror', slug: 'horror', sortOrder: 6 },
  { name: 'Romance', slug: 'romance', sortOrder: 7 },
  { name: 'Historical Fiction', slug: 'historical-fiction', sortOrder: 8 },
  { name: "Women's Fiction", slug: 'womens-fiction', sortOrder: 9 },
  { name: 'Biography & Memoir', slug: 'biography-memoir', sortOrder: 10 },
  { name: 'History', slug: 'history', sortOrder: 11 },
  { name: 'Religion & Spirituality', slug: 'religion-spirituality', sortOrder: 12 },
  { name: 'Self-Help', slug: 'self-help', sortOrder: 13 },
  { name: 'Science & Nature', slug: 'science-nature', sortOrder: 14 },
  { name: "Children's", slug: 'childrens', sortOrder: 15 },
  { name: 'Young Adult', slug: 'young-adult', sortOrder: 16 },
  { name: 'Classics', slug: 'classics', sortOrder: 17 },
];

// Pattern matching rules: [regex pattern, category slug]
// Order matters - first match wins
const MAPPING_RULES: [RegExp, string][] = [
  // Paranormal (before Horror to catch vampires, werewolves, witches)
  [/vampire/i, 'paranormal'],
  [/werewolf|werewolves/i, 'paranormal'],
  [/witch(es|craft)?/i, 'paranormal'],
  [/paranormal/i, 'paranormal'],
  [/supernatural/i, 'paranormal'],
  [/ghost(s)?/i, 'paranormal'],
  [/demon(s|ic)?/i, 'paranormal'],
  [/shapeshifter/i, 'paranormal'],
  
  // Horror
  [/horror/i, 'horror'],
  [/scary/i, 'horror'],
  [/creepy/i, 'horror'],
  
  // Science Fiction
  [/science\s*fiction/i, 'science-fiction'],
  [/sci-fi|scifi/i, 'science-fiction'],
  [/space\s*(opera|travel|exploration)/i, 'science-fiction'],
  [/dystopia/i, 'science-fiction'],
  [/time\s*travel/i, 'science-fiction'],
  [/alien(s)?/i, 'science-fiction'],
  [/robot(s|ics)?/i, 'science-fiction'],
  [/cyberpunk/i, 'science-fiction'],
  [/post-?apocalyptic/i, 'science-fiction'],
  
  // Fantasy
  [/fantasy/i, 'fantasy'],
  [/magic/i, 'fantasy'],
  [/dragon(s)?/i, 'fantasy'],
  [/wizard(s)?/i, 'fantasy'],
  [/fairies|fairy/i, 'fantasy'],
  [/elves|elf/i, 'fantasy'],
  [/sword(s)?.*sorcery/i, 'fantasy'],
  [/epic\s*fantasy/i, 'fantasy'],
  [/urban\s*fantasy/i, 'fantasy'],
  [/mythology|mythological/i, 'fantasy'],
  [/\bgods?\b/i, 'fantasy'],  // gods, god (but not "godzilla")
  
  // Mystery & Thriller
  [/mystery/i, 'mystery-thriller'],
  [/thriller/i, 'mystery-thriller'],
  [/suspense/i, 'mystery-thriller'],
  [/detective/i, 'mystery-thriller'],
  [/murder/i, 'mystery-thriller'],
  [/crime/i, 'mystery-thriller'],
  [/investigation/i, 'mystery-thriller'],
  [/police/i, 'mystery-thriller'],
  [/assassin/i, 'mystery-thriller'],
  [/spy|espionage/i, 'mystery-thriller'],
  [/missing\s*person/i, 'mystery-thriller'],
  
  // Romance
  [/romance/i, 'romance'],
  [/love\s*stor(y|ies)/i, 'romance'],
  [/romantic/i, 'romance'],
  
  // Historical Fiction
  [/historical\s*fiction/i, 'historical-fiction'],
  [/fiction.*historical/i, 'historical-fiction'],
  [/regency/i, 'historical-fiction'],
  [/medieval/i, 'historical-fiction'],
  [/victorian/i, 'historical-fiction'],
  [/world\s*war/i, 'historical-fiction'],
  [/civil\s*war/i, 'historical-fiction'],
  
  // Women's Fiction
  [/women'?s?\s*fiction/i, 'womens-fiction'],
  [/fiction.*women/i, 'womens-fiction'],
  [/chick\s*lit/i, 'womens-fiction'],
  
  // Biography & Memoir
  [/biography|biographies/i, 'biography-memoir'],
  [/memoir/i, 'biography-memoir'],
  [/autobiography/i, 'biography-memoir'],
  
  // History (non-fiction)
  [/^history$/i, 'history'],
  [/history.*nonfiction/i, 'history'],
  [/nonfiction.*history/i, 'history'],
  [/historical.*events/i, 'history'],
  
  // Religion & Spirituality (specific patterns for actual religious books, not fiction/mythology)
  [/christian\s*life/i, 'religion-spirituality'],
  [/spiritual\s*life/i, 'religion-spirituality'],
  [/devotional/i, 'religion-spirituality'],
  [/bible\s*stud/i, 'religion-spirituality'],
  [/theology/i, 'religion-spirituality'],
  [/apologetics/i, 'religion-spirituality'],
  [/evangelism/i, 'religion-spirituality'],
  [/scripture/i, 'religion-spirituality'],
  [/sermon/i, 'religion-spirituality'],
  [/^christianity$/i, 'religion-spirituality'],
  [/^religion$/i, 'religion-spirituality'],
  [/religion\s*&\s*spiritual/i, 'religion-spirituality'],
  [/christian\s*education/i, 'religion-spirituality'],
  [/christian\s*nonfiction/i, 'religion-spirituality'],
  
  // Self-Help
  [/self-?help/i, 'self-help'],
  [/personal\s*development/i, 'self-help'],
  [/motivation/i, 'self-help'],
  [/self-?improvement/i, 'self-help'],
  
  // Science & Nature
  [/science(?!\s*fiction)/i, 'science-nature'],
  [/nature/i, 'science-nature'],
  [/biology/i, 'science-nature'],
  [/physics/i, 'science-nature'],
  [/astronomy/i, 'science-nature'],
  [/environment/i, 'science-nature'],
  
  // Children's
  [/child(ren'?s?)?.*fiction/i, 'childrens'],
  [/juvenile/i, 'childrens'],
  [/picture\s*book/i, 'childrens'],
  [/middle\s*grade/i, 'childrens'],
  
  // Young Adult
  [/young\s*adult/i, 'young-adult'],
  [/ya\s*fiction/i, 'young-adult'],
  [/teen(age)?/i, 'young-adult'],
  
  // Classics
  [/classic(s|al)?/i, 'classics'],
  [/american\s*literature/i, 'classics'],
  [/english\s*literature/i, 'classics'],
  [/^literature$/i, 'classics'],
  [/literary\s*fiction/i, 'literary-fiction'],
];

// Genres to completely ignore (not real genres)
const IGNORE_PATTERNS = [
  /new\s*york\s*times/i,
  /bestseller/i,
  /staff\s*picks/i,
  /large\s*(type|print)/i,
  /reviewed/i,
  /award/i,
  /open\s*library/i,
  /reading\s*level/i,
  /^fiction$/i,  // Too generic
  /^general$/i,
  /fiction,?\s*general/i,
];

function findCategoryForGenre(genreName: string): string | null {
  // Check if should be ignored
  for (const pattern of IGNORE_PATTERNS) {
    if (pattern.test(genreName)) {
      return null;
    }
  }
  
  // Find matching category
  for (const [pattern, categorySlug] of MAPPING_RULES) {
    if (pattern.test(genreName)) {
      return categorySlug;
    }
  }
  
  return null;
}

async function main() {
  console.log('🏷️  Setting up categories...\n');
  
  // Create categories
  for (const cat of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name, sortOrder: cat.sortOrder },
      create: cat,
    });
  }
  console.log(`✅ Created/updated ${CATEGORIES.length} categories\n`);
  
  // Get all genres
  const genres = await prisma.genre.findMany({
    orderBy: { bookCount: 'desc' },
  });
  
  console.log(`📚 Processing ${genres.length} genres...\n`);
  
  // Get category map
  const categories = await prisma.category.findMany();
  const categoryMap = new Map(categories.map(c => [c.slug, c.id]));
  
  let mapped = 0;
  let ignored = 0;
  let unmapped = 0;
  const unmappedGenres: { name: string; count: number }[] = [];
  
  for (const genre of genres) {
    const categorySlug = findCategoryForGenre(genre.name);
    
    if (categorySlug === null) {
      // Check if explicitly ignored
      const isIgnored = IGNORE_PATTERNS.some(p => p.test(genre.name));
      if (isIgnored) {
        ignored++;
        await prisma.genre.update({
          where: { id: genre.id },
          data: { categoryId: null },
        });
      } else {
        unmapped++;
        if (genre.bookCount >= 3) {
          unmappedGenres.push({ name: genre.name, count: genre.bookCount });
        }
      }
    } else {
      const categoryId = categoryMap.get(categorySlug);
      if (categoryId) {
        await prisma.genre.update({
          where: { id: genre.id },
          data: { categoryId },
        });
        mapped++;
      }
    }
  }
  
  console.log(`\n📊 Results:`);
  console.log(`   Mapped: ${mapped}`);
  console.log(`   Ignored: ${ignored}`);
  console.log(`   Unmapped: ${unmapped}`);
  
  if (unmappedGenres.length > 0) {
    console.log(`\n⚠️  Unmapped genres with 3+ books:`);
    unmappedGenres.slice(0, 30).forEach(g => {
      console.log(`   ${String(g.count).padStart(3)} | ${g.name}`);
    });
  }
  
  // Show category book counts
  console.log('\n📈 Books per category:');
  const categoryCounts = await prisma.$queryRaw<{ name: string; count: bigint }[]>`
    SELECT c.name, COUNT(DISTINCT bg."bookId") as count
    FROM "Category" c
    LEFT JOIN "Genre" g ON g."categoryId" = c.id
    LEFT JOIN "BookGenre" bg ON bg."genreId" = g.id
    GROUP BY c.id, c.name, c."sortOrder"
    ORDER BY c."sortOrder"
  `;
  
  for (const row of categoryCounts) {
    console.log(`   ${String(row.count).padStart(4)} | ${row.name}`);
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
