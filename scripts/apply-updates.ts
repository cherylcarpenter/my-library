import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Initialize Prisma
const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const updateJsonPath = join(process.env.HOME || '', 'clawd/brain/projects/my-library/update.json');

// Map shelf values
const shelfMap: Record<string, string> = {
  'read': 'READ',
  'currently-reading': 'CURRENTLY_READING',
  'to-read': 'TO_READ',
  'to-read-sooner': 'TO_READ_SOONER',
  'did-not-finish': 'DID_NOT_FINISH',
};

async function getOrCreateLibrary() {
  // Find or create Cheryl's default library
  let library = await prisma.library.findFirst({
    where: { user: { email: 'cherylcarpenter2015@gmail.com' } }
  });

  if (!library) {
    // Create library for first user found
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('No user found');
    library = await prisma.library.create({
      data: {
        name: 'My Books',
        slug: 'my-books',
        userId: user.id,
      }
    });
  }

  return library;
}

async function slugify(text: string): Promise<string> {
  return text.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .substring(0, 100);
}

async function findBookByGoodreadsId(goodreadsId: string) {
  return prisma.book.findUnique({
    where: { goodreadsId },
    include: { authors: { include: { author: true } } }
  });
}

async function createBookWithEnrichment(bookData: any, libraryId: string) {
  const isbn = bookData.isbn && bookData.isbn !== '=' ? bookData.isbn : null;
  const isbn13 = bookData.isbn13 && bookData.isbn13 !== '=' ? bookData.isbn13 : null;

  // Create slug from title
  const baseSlug = await slugify(bookData.title);
  let slug = baseSlug;
  let counter = 1;
  while (await prisma.book.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  // Create book
  const book = await prisma.book.create({
    data: {
      title: bookData.title,
      slug,
      isbn,
      isbn13,
      goodreadsId: bookData.bookId,
      pages: bookData.pages || null,
      yearPublished: bookData.yearPublished || null,
      originalPublicationYear: bookData.originalPublicationYear || null,
      publisher: bookData.publisher || null,
      binding: bookData.binding || null,
      averageRating: bookData.averageRating || null,
      language: 'english',
      enrichmentStatus: 'PENDING',
    }
  });

  // Create author
  const authorSlug = await slugify(bookData.author);
  let author = await prisma.author.findUnique({ where: { slug: authorSlug } });
  
  if (!author) {
    author = await prisma.author.create({
      data: {
        name: bookData.author,
        slug: authorSlug,
        lastName: bookData.author.split(' ').pop() || bookData.author,
      }
    });
  }

  // Link author to book
  await prisma.bookAuthor.create({
    data: {
      bookId: book.id,
      authorId: author.id,
    }
  });

  // Create UserBook linkage
  const shelf = shelfMap[bookData.exclusiveShelf] || 'TO_READ';
  const dateRead = bookData.dateRead 
    ? new Date(bookData.dateRead.replace(/\//g, '-')) 
    : null;

  await prisma.userBook.create({
    data: {
      libraryId,
      bookId: book.id,
      shelf: shelf as any,
      dateRead,
      readCount: bookData.readCount || 0,
      myRating: bookData.myRating || null,
    }
  });

  console.log(`   ✅ Created: ${bookData.title}`);

  // Trigger enrichment
  await enrichBook(book.id, isbn, isbn13);

  return book;
}

async function enrichBook(bookId: string, isbn: string | null, isbn13: string | null) {
  // This would call OpenLibrary/Google Books enrichment
  // For now, just mark as pending
  await prisma.book.update({
    where: { id: bookId },
    data: { enrichmentStatus: 'PENDING' }
  });
}

async function main() {
  console.log('📖 Loading update.json...');
  const updates = JSON.parse(readFileSync(updateJsonPath, 'utf-8'));

  const library = await getOrCreateLibrary();
  console.log(`📚 Using library: ${library.name} (${library.id})`);

  // Apply updates to existing books
  console.log(`\n🔄 Applying ${updates.updates.length} updates...`);
  for (const update of updates.updates) {
    const book = await findBookByGoodreadsId(update.bookId);
    if (!book) {
      console.log(`   ⚠️ Book not found: ${update.title} (${update.bookId})`);
      continue;
    }

    // Find UserBook record
    const userBook = await prisma.userBook.findFirst({
      where: { libraryId: library.id, bookId: book.id }
    });

    if (userBook) {
      const shelf = update.changes.exclusiveShelf 
        ? shelfMap[update.changes.exclusiveShelf.to] 
        : userBook.shelf;
      
      const dateRead = update.changes.dateRead?.to
        ? new Date(update.changes.dateRead.to.replace(/\//g, '-'))
        : userBook.dateRead;

      const readCount = update.changes.readCount?.to ?? userBook.readCount;

      await prisma.userBook.update({
        where: { id: userBook.id },
        data: {
          shelf: shelf as any,
          dateRead,
          readCount,
        }
      });

      console.log(`   ✅ Updated: ${update.title} → ${shelf}`);
    } else {
      console.log(`   ⚠️ UserBook not found for: ${update.title}`);
    }
  }

  // Add new books with enrichment
  console.log(`\n✨ Adding ${updates.additions.length} new books with enrichment...`);
  for (const addition of updates.additions) {
    // Check if already exists
    const existing = await findBookByGoodreadsId(addition.bookId);
    if (existing) {
      console.log(`   ⚠️ Already exists: ${addition.title}`);
      continue;
    }

    await createBookWithEnrichment(addition, library.id);
  }

  console.log('\n✅ Done!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
