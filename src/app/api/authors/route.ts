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
    const sort = searchParams.get('sort') || 'lastName';
    const order = searchParams.get('order') || 'asc';
    
    // Letter filter (A-Z)
    const letter = searchParams.get('letter');
    
    // Build where clause
    const where: any = {};
    if (letter) {
      where.lastName = { startsWith: letter, mode: 'insensitive' };
    }
    
    // Get total count
    const total = await prisma.author.count({ where });
    
    // Get authors with book count
    const authors = await prisma.author.findMany({
      where,
      select: {
        id: true,
        name: true,
        lastName: true,
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
        : sort === 'lastName'
        ? { lastName: order }
        : { [sort]: order },
      skip,
      take: limit
    });
    
    // Format response
    const formattedAuthors = authors.map(author => ({
      id: author.id,
      name: author.name,
      lastName: author.lastName,
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
