import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const genres = await prisma.genre.findMany({
      orderBy: { bookCount: 'desc' },
      where: { bookCount: { gt: 0 } },
      select: {
        id: true,
        name: true,
        slug: true,
        bookCount: true,
      },
    });

    return NextResponse.json(genres);
  } catch (error) {
    console.error('Error fetching genres:', error);
    return NextResponse.json({ error: 'Failed to fetch genres' }, { status: 500 });
  }
}
