import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    
    const series = await prisma.series.findUnique({
      where: { slug },
      include: {
        books: {
          include: {
            authors: {
              include: {
                author: {
                  select: {
                    id: true,
                    name: true,
                    slug: true
                  }
                }
              }
            },
            userBooks: {
              select: {
                shelf: true,
                myRating: true,
                dateRead: true,
                ownedKindle: true,
                ownedAudible: true
              },
              take: 1
            }
          },
          orderBy: {
            seriesOrder: 'asc'
          }
        }
      }
    });
    
    if (!series) {
      return NextResponse.json(
        { error: 'Series not found' },
        { status: 404 }
      );
    }
    
    // Calculate completion stats
    const bookCount = series.books.length;
    const booksRead = series.books.filter(
      book => book.userBooks[0]?.shelf === 'READ'
    ).length;
    
    // Format response
    const response = {
      id: series.id,
      name: series.name,
      slug: series.slug,
      description: series.description,
      bookCount,
      booksRead,
      completionPercentage: bookCount > 0 
        ? Math.round((booksRead / bookCount) * 100) 
        : 0,
      isComplete: bookCount > 0 && booksRead === bookCount,
      books: series.books.map(book => ({
        id: book.id,
        title: book.title,
        slug: book.slug,
        coverUrl: book.coverUrl,
        seriesOrder: book.seriesOrder,
        yearPublished: book.yearPublished,
        pages: book.pages,
        averageRating: book.averageRating,
        authors: book.authors.map(ba => ({
          id: ba.author.id,
          name: ba.author.name,
          slug: ba.author.slug,
          role: ba.role
        })),
        userBook: book.userBooks[0] ? {
          shelf: book.userBooks[0].shelf,
          myRating: book.userBooks[0].myRating,
          dateRead: book.userBooks[0].dateRead,
          ownedKindle: book.userBooks[0].ownedKindle,
          ownedAudible: book.userBooks[0].ownedAudible
        } : null
      })),
      createdAt: series.createdAt,
      updatedAt: series.updatedAt
    };
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching series:', error);
    return NextResponse.json(
      { error: 'Failed to fetch series' },
      { status: 500 }
    );
  }
}
