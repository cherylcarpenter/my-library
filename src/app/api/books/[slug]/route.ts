import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    
    const book = await prisma.book.findUnique({
      where: { slug },
      include: {
        authors: {
          include: {
            author: true
          }
        },
        series: true,
        userBooks: {
          select: {
            id: true,
            shelf: true,
            dateRead: true,
            dateAdded: true,
            readCount: true,
            myRating: true,
            myReview: true,
            ownedKindle: true,
            ownedAudible: true,
            kindleAsin: true,
            audibleAsin: true,
            audibleDuration: true,
            audibleNarrators: true
          },
          take: 1
        }
      }
    });
    
    if (!book) {
      return NextResponse.json(
        { error: 'Book not found' },
        { status: 404 }
      );
    }
    
    // Format response
    const response = {
      id: book.id,
      title: book.title,
      slug: book.slug,
      isbn: book.isbn,
      isbn13: book.isbn13,
      goodreadsId: book.goodreadsId,
      openLibraryId: book.openLibraryId,
      description: book.description,
      coverUrl: book.coverUrl,
      pages: book.pages,
      yearPublished: book.yearPublished,
      originalPublicationYear: book.originalPublicationYear,
      publisher: book.publisher,
      binding: book.binding,
      language: book.language,
      averageRating: book.averageRating,
      enrichedAt: book.enrichedAt,
      enrichmentStatus: book.enrichmentStatus,
      authors: book.authors.map(ba => ({
        id: ba.author.id,
        name: ba.author.name,
        slug: ba.author.slug,
        role: ba.role,
        bio: ba.author.bio,
        photoUrl: ba.author.photoUrl,
        openLibraryId: ba.author.openLibraryId
      })),
      series: book.series ? {
        id: book.series.id,
        name: book.series.name,
        slug: book.series.slug,
        order: book.seriesOrder
      } : null,
      userBook: book.userBooks[0] ? {
        shelf: book.userBooks[0].shelf,
        dateRead: book.userBooks[0].dateRead,
        dateAdded: book.userBooks[0].dateAdded,
        readCount: book.userBooks[0].readCount,
        myRating: book.userBooks[0].myRating,
        myReview: book.userBooks[0].myReview,
        ownedKindle: book.userBooks[0].ownedKindle,
        ownedAudible: book.userBooks[0].ownedAudible,
        kindleAsin: book.userBooks[0].kindleAsin,
        audibleAsin: book.userBooks[0].audibleAsin,
        audibleDuration: book.userBooks[0].audibleDuration,
        audibleNarrators: book.userBooks[0].audibleNarrators
      } : null,
      createdAt: book.createdAt,
      updatedAt: book.updatedAt
    };
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching book:', error);
    return NextResponse.json(
      { error: 'Failed to fetch book' },
      { status: 500 }
    );
  }
}
