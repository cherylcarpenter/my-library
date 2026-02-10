import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';

interface BookSearchRow {
  id: string;
  title: string;
  slug: string;
  cover_url: string | null;
  year_published: number | null;
  rank: number;
}

interface AuthorSearchRow {
  id: string;
  name: string;
  slug: string;
  photo_url: string | null;
  book_count: bigint;
  rank: number;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim() || '';
    const limit = parseInt(searchParams.get('limit') || '5');
    const page = parseInt(searchParams.get('page') || '1');
    const offset = (page - 1) * limit;

    if (query.length < 2) {
      return NextResponse.json({ books: [], authors: [] });
    }

    // Sanitize query for tsquery: remove special characters, build prefix query
    const sanitized = query.replace(/[^\w\s]/g, '').trim();
    const terms = sanitized.split(/\s+/).filter(Boolean);
    if (terms.length === 0) {
      return NextResponse.json({ books: [], authors: [] });
    }

    // Build prefix tsquery: each word gets :* for prefix matching
    // Words are joined with & (AND) so all terms must match
    const tsquery = terms.map(t => `${t}:*`).join(' & ');

    // Search books (only those in user's library via UserBook join)
    // Also do an ILIKE fallback for short/exact matches that tsvector might miss
    const booksPromise = prisma.$queryRaw<BookSearchRow[]>`
      SELECT DISTINCT b."id", b."title", b."slug", b."coverUrl" as cover_url,
             b."yearPublished" as year_published,
             ts_rank(b."search_vector", to_tsquery('english', ${tsquery})) as rank
      FROM "Book" b
      INNER JOIN "UserBook" ub ON ub."bookId" = b."id"
      WHERE b."search_vector" @@ to_tsquery('english', ${tsquery})
         OR b."title" ILIKE ${`%${sanitized}%`}
      ORDER BY rank DESC, b."title" ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    // Search authors (only those with books in the user's library)
    const authorsPromise = prisma.$queryRaw<AuthorSearchRow[]>`
      SELECT DISTINCT a."id", a."name", a."slug", a."photoUrl" as photo_url,
             (SELECT COUNT(DISTINCT ba2."bookId")
              FROM "BookAuthor" ba2
              INNER JOIN "UserBook" ub2 ON ub2."bookId" = ba2."bookId"
              WHERE ba2."authorId" = a."id") as book_count,
             ts_rank(a."search_vector", to_tsquery('english', ${tsquery})) as rank
      FROM "Author" a
      INNER JOIN "BookAuthor" ba ON ba."authorId" = a."id"
      INNER JOIN "UserBook" ub ON ub."bookId" = ba."bookId"
      WHERE a."search_vector" @@ to_tsquery('english', ${tsquery})
         OR a."name" ILIKE ${`%${sanitized}%`}
      ORDER BY rank DESC, a."name" ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [bookRows, authorRows] = await Promise.all([booksPromise, authorsPromise]);

    // For books, fetch their authors in a second query
    const bookIds = bookRows.map(b => b.id);
    const bookAuthors = bookIds.length > 0
      ? await prisma.bookAuthor.findMany({
          where: { bookId: { in: bookIds } },
          select: {
            bookId: true,
            author: {
              select: { id: true, name: true, slug: true }
            }
          }
        })
      : [];

    // Group authors by bookId
    const authorsByBook = new Map<string, { id: string; name: string; slug: string }[]>();
    for (const ba of bookAuthors) {
      const list = authorsByBook.get(ba.bookId) || [];
      list.push(ba.author);
      authorsByBook.set(ba.bookId, list);
    }

    const books = bookRows.map(row => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      coverUrl: row.cover_url,
      yearPublished: row.year_published,
      authors: authorsByBook.get(row.id) || []
    }));

    const authors = authorRows.map(row => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      photoUrl: row.photo_url,
      bookCount: Number(row.book_count)
    }));

    return NextResponse.json({ books, authors });
  } catch (error) {
    console.error('Error searching:', error);
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    );
  }
}
