import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    // Get categories with book counts (via genres)
    const categories = await prisma.category.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: {
          select: {
            genres: true,
          },
        },
        genres: {
          select: {
            id: true,
            bookCount: true,
          },
        },
      },
    });

    // Calculate total books per category
    const result = categories.map((cat) => {
      const bookCount = cat.genres.reduce((sum, g) => sum + g.bookCount, 0);
      return {
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        bookCount,
      };
    }).filter(cat => cat.bookCount > 0); // Only show categories with books

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching categories:', error);
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
  }
}
