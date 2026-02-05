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
    const total = await prisma.author.count();
    
    // Get authors with book count
    const authors = await prisma.author.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        photoUrl: true,
        _count: {
          select: {
            books: true
          }
        }
      },
      orderBy: sort === 'bookCount'
        ? { books: { _count: order as 'asc' | 'desc' } }
        : { [sort]: order },
      skip,
      take: limit
    });
    
    // Format response
    const formattedAuthors = authors.map(author => ({
      id: author.id,
      name: author.name,
      slug: author.slug,
      photoUrl: author.photoUrl,
      bookCount: author._count.books
    }));
    
    return NextResponse.json({
      authors: formattedAuthors,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching authors:', error);
    return NextResponse.json(
      { error: 'Failed to fetch authors' },
      { status: 500 }
    );
  }
}
