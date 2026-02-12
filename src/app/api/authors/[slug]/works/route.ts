import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

interface OpenLibraryWork {
  key: string;
  title: string;
  covers?: number[];
  first_publish_date?: string;
  description?: string | { value: string };
}

interface OpenLibraryWorksResponse {
  entries: OpenLibraryWork[];
  size: number;
}

// Fetch cover from Google Books as fallback (non-blocking, 5s timeout)
async function getGoogleBooksCover(title: string, authorName: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const query = encodeURIComponent(`${title} inauthor:${authorName}`);
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    
    if (!res.ok) return null;
    const data = await res.json();
    const thumbnail = data.items?.[0]?.volumeInfo?.imageLinks?.thumbnail;
    if (!thumbnail) return null;
    
    // Convert to https and get larger image
    const coverUrl = thumbnail.replace('http://', 'https://').replace('zoom=1', 'zoom=2');
    
    // Check if it's a real cover (not a placeholder) by checking file size
    // Placeholder images are typically small (< 20KB)
    try {
      const headRes = await fetch(coverUrl, { method: 'HEAD' });
      const contentLength = parseInt(headRes.headers.get('content-length') || '0');
      if (contentLength < 20000) {
        return null; // Likely a placeholder image
      }
    } catch {
      // If HEAD fails, skip this cover
      return null;
    }
    
    return coverUrl;
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    
    // Get author from database
    const author = await prisma.author.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        openLibraryId: true,
        books: {
          select: {
            book: {
              select: {
                id: true,
                title: true,
                slug: true,
                openLibraryKey: true,
              }
            }
          }
        }
      }
    });
    
    if (!author) {
      return NextResponse.json({ error: 'Author not found' }, { status: 404 });
    }
    
    if (!author.openLibraryId) {
      return NextResponse.json({ 
        works: [], 
        message: 'Author has no OpenLibrary ID' 
      });
    }
    
    // Fetch works from OpenLibrary
    const olResponse = await fetch(
      `https://openlibrary.org/authors/${author.openLibraryId}/works.json?limit=100`,
      { next: { revalidate: 86400 } } // Cache for 24 hours
    );
    
    if (!olResponse.ok) {
      return NextResponse.json({ 
        works: [], 
        message: 'Failed to fetch from OpenLibrary' 
      });
    }
    
    const olData: OpenLibraryWorksResponse = await olResponse.json();
    
    // Get list of books already in library (by title, normalized)
    const ownedTitles = new Set(
      author.books.map(ba => ba.book.title.toLowerCase().trim())
    );
    const ownedKeys = new Set(
      author.books
        .filter(ba => ba.book.openLibraryKey)
        .map(ba => ba.book.openLibraryKey)
    );
    
    // Filter out non-English works (Hebrew, German, etc.)
    const isEnglishTitle = (title: string): boolean => {
      // Filter out Hebrew, Arabic, Chinese, Japanese, Korean, Cyrillic
      const nonLatinPattern = /[\u0590-\u05FF\u0600-\u06FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\u0400-\u04FF]/;
      if (nonLatinPattern.test(title)) return false;
      
      // Filter out German titles (common German-only characters and words)
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
    
    const englishEntries = (olData.entries || []).filter(work => isEnglishTitle(work.title));
    
    // Format works (OpenLibrary covers only for speed)
    const works = englishEntries.map((work) => {
      const workKey = work.key.replace('/works/', '');
      const isOwned = ownedKeys.has(workKey) || 
                      ownedTitles.has(work.title.toLowerCase().trim());
      
      // Find the owned book if it exists
      const ownedBook = author.books.find(ba => 
        ba.book.openLibraryKey === workKey ||
        ba.book.title.toLowerCase().trim() === work.title.toLowerCase().trim()
      );
      
      // Use OpenLibrary cover only (skip slow Google Books fallback)
      const coverUrl = work.covers?.[0] 
        ? `https://covers.openlibrary.org/b/id/${work.covers[0]}-M.jpg`
        : null;
      
      return {
        key: workKey,
        title: work.title,
        coverUrl,
        firstPublishYear: work.first_publish_date 
          ? parseInt(work.first_publish_date) || work.first_publish_date
          : null,
        isOwned,
        ownedBookSlug: ownedBook?.book.slug || null,
        openLibraryUrl: `https://openlibrary.org${work.key}`,
      };
    });
    
    // Sort: owned books first, then by year (newest first)
    works.sort((a, b) => {
      if (a.isOwned !== b.isOwned) return a.isOwned ? -1 : 1;
      const yearA = typeof a.firstPublishYear === 'number' ? a.firstPublishYear : 0;
      const yearB = typeof b.firstPublishYear === 'number' ? b.firstPublishYear : 0;
      return yearB - yearA;
    });
    
    return NextResponse.json({
      authorName: author.name,
      totalWorks: works.length,
      works,
    });
  } catch (error) {
    console.error('Error fetching author works:', error);
    return NextResponse.json(
      { error: 'Failed to fetch author works' },
      { status: 500 }
    );
  }
}
