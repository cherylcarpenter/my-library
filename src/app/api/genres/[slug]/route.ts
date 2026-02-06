import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const genre = await prisma.genre.findUnique({
      where: { slug },
      include: {
        books: {
          include: {
            book: {
              include: {
                authors: {
                  include: {
                    author: true,
                  },
                },
              },
            },
          },
          take: 50,
        },
      },
    });

    if (!genre) {
      return NextResponse.json({ error: 'Genre not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: genre.id,
      name: genre.name,
      slug: genre.slug,
      bookCount: genre.bookCount,
      books: genre.books.map((bg) => ({
        id: bg.book.id,
        title: bg.book.title,
        slug: bg.book.slug,
        coverUrl: bg.book.coverUrl,
        authors: bg.book.authors.map((ba) => ({
          name: ba.author.name,
          slug: ba.author.slug,
        })),
      })),
    });
  } catch (error) {
    console.error('Error fetching genre:', error);
    return NextResponse.json({ error: 'Failed to fetch genre' }, { status: 500 });
  }
}
