import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

interface OpenLibraryWork {
  key: string;
  title: string;
  covers?: number[];
  first_publish_year?: number;
}

interface SeriesWork {
  key: string;
  title: string;
  coverUrl: string | null;
  firstPublishYear: number | string | null;
  isOwned: boolean;
  ownedBookSlug: string | null;
  openLibraryUrl: string;
  seriesPosition?: number | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    
    // Get series with its books
    const series = await prisma.series.findUnique({
      where: { slug },
      include: {
        books: {
          select: {
            title: true,
            slug: true,
            isbn: true,
            isbn13: true,
          }
        }
      }
    });
    
    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }
    
    // Search OpenLibrary for series books
    const encodedName = encodeURIComponent(series.name);
    const searchUrl = `https://openlibrary.org/search.json?q=${encodedName}&limit=50`;
    
    const response = await fetch(searchUrl, {
      headers: { 'User-Agent': 'MyLibrary/1.0' }
    });
    
    if (!response.ok) {
      return NextResponse.json({ works: [], totalWorks: 0 });
    }
    
    const data = await response.json();
    
    // Get owned book titles (normalized for comparison)
    const ownedTitles = new Set(
      series.books.map(b => b.title.toLowerCase().replace(/[^\w\s]/g, '').trim())
    );
    const ownedSlugs = new Map(
      series.books.map(b => [b.title.toLowerCase().replace(/[^\w\s]/g, '').trim(), b.slug])
    );
    
    // Process works
    const works: SeriesWork[] = [];
    const seenTitles = new Set<string>();
    
    for (const doc of data.docs || []) {
      if (!doc.title) continue;
      
      const normalizedTitle = doc.title.toLowerCase().replace(/[^\w\s]/g, '').trim();
      
      // Skip duplicates
      if (seenTitles.has(normalizedTitle)) continue;
      seenTitles.add(normalizedTitle);
      
      const isOwned = ownedTitles.has(normalizedTitle);
      
      works.push({
        key: doc.key || '',
        title: doc.title,
        coverUrl: doc.cover_i 
          ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
          : null,
        firstPublishYear: doc.first_publish_year || null,
        isOwned,
        ownedBookSlug: isOwned ? ownedSlugs.get(normalizedTitle) || null : null,
        openLibraryUrl: doc.key ? `https://openlibrary.org${doc.key}` : '',
        seriesPosition: null, // OpenLibrary doesn't reliably provide this
      });
    }
    
    // Sort: owned first, then by year
    works.sort((a, b) => {
      if (a.isOwned !== b.isOwned) return a.isOwned ? -1 : 1;
      const yearA = typeof a.firstPublishYear === 'number' ? a.firstPublishYear : 9999;
      const yearB = typeof b.firstPublishYear === 'number' ? b.firstPublishYear : 9999;
      return yearA - yearB;
    });
    
    return NextResponse.json({
      works,
      totalWorks: works.length,
      seriesName: series.name,
    });
  } catch (error) {
    console.error('Error fetching series works:', error);
    return NextResponse.json({ works: [], totalWorks: 0 });
  }
}
