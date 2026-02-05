import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Pagination
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const skip = (page - 1) * limit;
    
    // Sorting
    const sort = searchParams.get('sort') || 'name';
    const order = searchParams.get('order') || 'asc';
    
    // Get total count
    const total = await prisma.series.count();
    
    // Get series with book count and completion status
    const seriesList = await prisma.series.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        books: {
          select: {
            id: true,
            userBooks: {
              select: {
                shelf: true
              },
              take: 1
            }
          }
        }
      },
      orderBy: sort === 'bookCount'
        ? { books: { _count: order as 'asc' | 'desc' } }
        : { [sort]: order },
      skip,
      take: limit
    });
    
    // Format response with completion status
    const formattedSeries = seriesList.map(series => {
      const bookCount = series.books.length;
      const booksRead = series.books.filter(
        book => book.userBooks[0]?.shelf === 'READ'
      ).length;
      
      return {
        id: series.id,
        name: series.name,
        slug: series.slug,
        bookCount,
        booksRead,
        completionPercentage: bookCount > 0 
          ? Math.round((booksRead / bookCount) * 100) 
          : 0,
        isComplete: bookCount > 0 && booksRead === bookCount
      };
    });
    
    return NextResponse.json({
      series: formattedSeries,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching series:', error);
    return NextResponse.json(
      { error: 'Failed to fetch series' },
      { status: 500 }
    );
  }
}
