import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    // Get all user books with their book details for aggregate calculations
    const userBooks = await prisma.userBook.findMany({
      include: {
        book: {
          select: {
            pages: true
          }
        }
      }
    });
    
    // Total books
    const totalBooks = userBooks.length;
    
    // Books by shelf
    const shelfCounts: Record<string, number> = {
      READ: 0,
      CURRENTLY_READING: 0,
      TO_READ: 0,
      TO_READ_SOONER: 0,
      DID_NOT_FINISH: 0
    };
    
    userBooks.forEach(ub => {
      if (ub.shelf in shelfCounts) {
        shelfCounts[ub.shelf]++;
      }
    });
    
    // Books read (includes READ shelf)
    const booksRead = shelfCounts.READ;
    
    // Pages read (only for READ books)
    const pagesRead = userBooks
      .filter(ub => ub.shelf === 'READ')
      .reduce((sum, ub) => sum + (ub.book.pages || 0), 0);
    
    // Books by rating
    const ratingCounts: Record<number, number> = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0
    };
    
    userBooks.forEach(ub => {
      if (ub.myRating && ub.myRating >= 1 && ub.myRating <= 5) {
        ratingCounts[ub.myRating]++;
      }
    });
    
    // Average rating
    const ratedBooks = userBooks.filter(ub => ub.myRating);
    const averageRating = ratedBooks.length > 0
      ? ratedBooks.reduce((sum, ub) => sum + (ub.myRating || 0), 0) / ratedBooks.length
      : 0;
    
    // Ownership counts
    const ownedKindle = userBooks.filter(ub => ub.ownedKindle).length;
    const ownedAudible = userBooks.filter(ub => ub.ownedAudible).length;
    const ownedBoth = userBooks.filter(ub => ub.ownedKindle && ub.ownedAudible).length;
    
    // Author and Series counts
    const authorCount = await prisma.author.count();
    const seriesCount = await prisma.series.count();
    
    // Books read this year
    const currentYear = new Date().getFullYear();
    const startOfYear = new Date(currentYear, 0, 1);
    const booksReadThisYear = userBooks.filter(ub => 
      ub.shelf === 'READ' && 
      ub.dateRead && 
      new Date(ub.dateRead) >= startOfYear
    ).length;
    
    // Pages read this year
    const pagesReadThisYear = userBooks
      .filter(ub => 
        ub.shelf === 'READ' && 
        ub.dateRead && 
        new Date(ub.dateRead) >= startOfYear
      )
      .reduce((sum, ub) => sum + (ub.book.pages || 0), 0);
    
    return NextResponse.json({
      overview: {
        totalBooks,
        booksRead,
        pagesRead,
        authorCount,
        seriesCount,
        averageRating: Math.round(averageRating * 100) / 100
      },
      thisYear: {
        year: currentYear,
        booksRead: booksReadThisYear,
        pagesRead: pagesReadThisYear
      },
      byShelf: shelfCounts,
      byRating: ratingCounts,
      ownership: {
        kindle: ownedKindle,
        audible: ownedAudible,
        both: ownedBoth,
        total: ownedKindle + ownedAudible - ownedBoth
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
