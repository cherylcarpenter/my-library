import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    // Get counts for each shelf
    const shelfCounts = await prisma.userBook.groupBy({
      by: ['shelf'],
      _count: {
        id: true
      }
    });
    
    // Define shelf metadata
    const shelfInfo: Record<string, { label: string; description: string }> = {
      READ: {
        label: 'Read',
        description: 'Books I\'ve finished reading'
      },
      CURRENTLY_READING: {
        label: 'Currently Reading',
        description: 'Books I\'m reading right now'
      },
      TO_READ: {
        label: 'To Read',
        description: 'Books on my reading list'
      },
      TO_READ_SOONER: {
        label: 'To Read Sooner',
        description: 'Priority books to read next'
      },
      DID_NOT_FINISH: {
        label: 'Did Not Finish',
        description: 'Books I started but didn\'t complete'
      }
    };
    
    // Build response with all shelves (even if count is 0)
    const shelves = Object.keys(shelfInfo).map(shelf => {
      const countEntry = shelfCounts.find(sc => sc.shelf === shelf);
      return {
        id: shelf,
        ...shelfInfo[shelf],
        count: countEntry?._count.id || 0
      };
    });
    
    // Total across all shelves
    const totalBooks = shelves.reduce((sum, shelf) => sum + shelf.count, 0);
    
    return NextResponse.json({
      shelves,
      totalBooks
    });
  } catch (error) {
    console.error('Error fetching shelves:', error);
    return NextResponse.json(
      { error: 'Failed to fetch shelves' },
      { status: 500 }
    );
  }
}
