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
    
    // Filter out non-English works
    const isEnglishTitle = (title: string): boolean => {
      // Filter out Hebrew, Arabic, Chinese, Japanese, Korean, Cyrillic
      const nonLatinPattern = /[\u0590-\u05FF\u0600-\u06FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\u0400-\u04FF]/;
      if (nonLatinPattern.test(title)) return false;
      
      // Filter out German titles
      const germanPattern = /[äöüßÄÖÜ]|(\b(und|der|die|das|ein|eine|einer|des|dem|den|für|über|unter)\b)/i;
      if (germanPattern.test(title)) return false;
      
      // Filter out French titles
      const frenchPattern = /[àâçéèêëîïôùûüÿœæ]|(\b(le|la|les|du|de|des|un|une|et|pour|avec|sur|dans)\b)/i;
      if (frenchPattern.test(title)) return false;
      
      // Filter out Spanish/Portuguese titles  
      const spanishPattern = /[ñáéíóúü¿¡]|(\b(el|los|las|del|por|para|con|una|uno)\b)/i;
      if (spanishPattern.test(title)) return false;
      
      // Filter out Polish titles
      const polishPattern = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]|(\b(i|w|z|na|do|od|po|za|dla|jak|nie|tak|jest|są)\b)/i;
      if (polishPattern.test(title)) return false;
      
      // Filter out Italian titles
      const italianPattern = /(\b(il|lo|la|gli|le|di|da|in|su|per|con|tra|fra|che|non|sono)\b)/i;
      if (italianPattern.test(title)) return false;
      
      // Filter out Dutch titles
      const dutchPattern = /[ĳ]|(\b(het|een|van|naar|voor|met|aan|uit|bij)\b)/i;
      if (dutchPattern.test(title)) return false;
      
      return true;
    };
    
    // Process works
    const works: SeriesWork[] = [];
    const seenTitles = new Set<string>();
    
    for (const doc of data.docs || []) {
      if (!doc.title || !isEnglishTitle(doc.title)) continue;
      
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
