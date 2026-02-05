import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    
    const author = await prisma.author.findUnique({
      where: { slug },
      include: {
        books: {
          include: {
            book: {
              include: {
                series: {
                  select: {
                    id: true,
                    name: true,
                    slug: true
                  }
                },
                userBooks: {
                  select: {
                    shelf: true,
                    myRating: true,
                    ownedKindle: true,
                    ownedAudible: true
                  },
                  take: 1
                }
              }
            }
          }
        }
      }
    });
    
    if (!author) {
      return NextResponse.json(
        { error: 'Author not found' },
        { status: 404 }
      );
    }
    
    // Format response
    const response = {
      id: author.id,
      name: author.name,
      slug: author.slug,
      openLibraryId: author.openLibraryId,
      bio: author.bio,
      photoUrl: author.photoUrl,
      birthDate: author.birthDate,
      deathDate: author.deathDate,
      enrichedAt: author.enrichedAt,
      bookCount: author.books.length,
      books: author.books.map(ba => ({
        id: ba.book.id,
        title: ba.book.title,
        slug: ba.book.slug,
        coverUrl: ba.book.coverUrl,
        yearPublished: ba.book.yearPublished,
        averageRating: ba.book.averageRating,
        role: ba.role,
        series: ba.book.series ? {
          id: ba.book.series.id,
          name: ba.book.series.name,
          slug: ba.book.series.slug,
          order: ba.book.seriesOrder
        } : null,
        userBook: ba.book.userBooks[0] ? {
          shelf: ba.book.userBooks[0].shelf,
          myRating: ba.book.userBooks[0].myRating,
          ownedKindle: ba.book.userBooks[0].ownedKindle,
          ownedAudible: ba.book.userBooks[0].ownedAudible
        } : null
      })),
      createdAt: author.createdAt,
      updatedAt: author.updatedAt
    };
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching author:', error);
    return NextResponse.json(
      { error: 'Failed to fetch author' },
      { status: 500 }
    );
  }
}
