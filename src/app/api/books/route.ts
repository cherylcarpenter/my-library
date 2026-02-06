import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Shelf } from '@prisma/client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Pagination
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;
    
    // Filters - normalize shelf to uppercase enum format
    const shelfParam = searchParams.get('shelf');
    const shelf = shelfParam 
      ? shelfParam.toUpperCase().replace(/-/g, '_') as Shelf 
      : null;
    const rating = searchParams.get('rating');
    const ownedKindle = searchParams.get('kindle');
    const ownedAudible = searchParams.get('audible');
    const genre = searchParams.get('genre'); // Genre slug filter
    
    // Sorting - support `-field` for descending
    let sortParam = searchParams.get('sort') || 'dateAdded';
    let order = searchParams.get('order') || 'desc';
    
    // Parse `-` prefix for descending order
    if (sortParam.startsWith('-')) {
      sortParam = sortParam.slice(1);
      order = 'desc';
    } else if (sortParam && !searchParams.get('order')) {
      order = 'asc';
    }
    const sort = sortParam;
    
    // Build where clause for UserBook
    const userBookWhere: Record<string, unknown> = {};
    if (shelf) userBookWhere.shelf = shelf;
    if (rating) userBookWhere.myRating = parseInt(rating);
    if (ownedKindle === 'true') userBookWhere.ownedKindle = true;
    if (ownedAudible === 'true') userBookWhere.ownedAudible = true;
    
    // Build where clause for Book (including genre filter)
    const bookWhere: Record<string, unknown> = {};
    if (genre) {
      bookWhere.genres = {
        some: {
          genre: {
            slug: genre
          }
        }
      };
    }
    
    // Determine sort field and direction
    const orderBy: Record<string, unknown>[] = [];
    const validBookSorts = ['title', 'yearPublished', 'averageRating', 'pages'];
    const validUserBookSorts = ['dateAdded', 'dateRead', 'myRating'];
    
    if (validBookSorts.includes(sort)) {
      orderBy.push({ [sort]: order });
    } else if (validUserBookSorts.includes(sort)) {
      // Sort by userBook field - we'll handle this through userBooks relation
      orderBy.push({ userBooks: { _count: order } }); // Fallback, actual sort below
    } else {
      orderBy.push({ title: 'asc' });
    }
    
    // Get total count
    const total = await prisma.book.count({
      where: {
        ...bookWhere,
        userBooks: {
          some: userBookWhere
        }
      }
    });
    
    // For userBook sorts, we need to fetch more and sort in memory
    const needsMemorySort = validUserBookSorts.includes(sort);
    const fetchLimit = needsMemorySort ? Math.min(total, 100) : limit;
    const fetchSkip = needsMemorySort ? 0 : skip;
    
    // Get books with relations
    const books = await prisma.book.findMany({
      where: {
        ...bookWhere,
        userBooks: {
          some: userBookWhere
        }
      },
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
        series: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        },
        genres: {
          include: {
            genre: {
              select: {
                id: true,
                name: true,
                slug: true
              }
            }
          },
          take: 3 // Limit genres per book
        },
        userBooks: {
          where: userBookWhere,
          select: {
            shelf: true,
            dateRead: true,
            dateAdded: true,
            myRating: true,
            ownedKindle: true,
            ownedAudible: true
          },
          take: 1
        }
      },
      orderBy: needsMemorySort ? undefined : orderBy,
      skip: fetchSkip,
      take: fetchLimit
    });
    
    // If sorting by userBook fields, we need to sort in memory then paginate
    let sortedBooks = books;
    if (needsMemorySort) {
      sortedBooks = [...books].sort((a, b) => {
        const aUserBook = a.userBooks[0];
        const bUserBook = b.userBooks[0];
        
        let aVal: unknown = null;
        let bVal: unknown = null;
        
        if (sort === 'dateAdded') {
          aVal = aUserBook?.dateAdded;
          bVal = bUserBook?.dateAdded;
        } else if (sort === 'dateRead') {
          aVal = aUserBook?.dateRead;
          bVal = bUserBook?.dateRead;
        } else if (sort === 'myRating') {
          aVal = aUserBook?.myRating;
          bVal = bUserBook?.myRating;
        }
        
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        
        const comparison = aVal! < bVal! ? -1 : aVal! > bVal! ? 1 : 0;
        return order === 'desc' ? -comparison : comparison;
      });
      
      // Apply pagination after sorting
      sortedBooks = sortedBooks.slice(skip, skip + limit);
    }
    
    // Format response
    const formattedBooks = sortedBooks.map(book => ({
      id: book.id,
      title: book.title,
      slug: book.slug,
      coverUrl: book.coverUrl,
      pages: book.pages,
      yearPublished: book.yearPublished,
      averageRating: book.averageRating,
      authors: book.authors.map(ba => ({
        id: ba.author.id,
        name: ba.author.name,
        slug: ba.author.slug,
        role: ba.role
      })),
      series: book.series ? {
        id: book.series.id,
        name: book.series.name,
        slug: book.series.slug,
        order: book.seriesOrder
      } : null,
      genres: book.genres.map(g => ({
        id: g.genre.id,
        name: g.genre.name,
        slug: g.genre.slug
      })),
      userBook: book.userBooks[0] ? {
        shelf: book.userBooks[0].shelf,
        dateRead: book.userBooks[0].dateRead,
        dateAdded: book.userBooks[0].dateAdded,
        myRating: book.userBooks[0].myRating,
        ownedKindle: book.userBooks[0].ownedKindle,
        ownedAudible: book.userBooks[0].ownedAudible
      } : null
    }));
    
    return NextResponse.json({
      books: formattedBooks,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching books:', error);
    return NextResponse.json(
      { error: 'Failed to fetch books' },
      { status: 500 }
    );
  }
}
