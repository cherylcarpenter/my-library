import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    // Get categories with genres
    const categories = await prisma.category.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        genres: {
          select: {
            id: true,
          },
        },
      },
    });

    // Calculate total books per category dynamically
    const result = await Promise.all(categories.map(async (cat) => {
      // Count unique books in this category (books in user's library with genres in this category)
      const bookCount = await prisma.book.count({
        where: {
          userBooks: { some: {} },
          genres: {
            some: {
              genre: {
                categoryId: cat.id
              }
            }
          }
        }
      });
      
      return {
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        bookCount,
      };
    }));
    
    // Filter to only show categories with books
    const filteredResult = result.filter(cat => cat.bookCount > 0);

    // Count uncategorized books (books with no genre associations that are in a user's library)
    const uncategorizedCount = await prisma.book.count({
      where: {
        genres: { none: {} },
        userBooks: { some: {} }
      }
    });

    // Add uncategorized option at the end if there are any
    if (uncategorizedCount > 0) {
      filteredResult.push({
        id: 'uncategorized',
        name: 'Uncategorized',
        slug: 'uncategorized',
        bookCount: uncategorizedCount,
      });
    }

    return NextResponse.json(filteredResult);
  } catch (error) {
    console.error('Error fetching categories:', error);
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
  }
}
