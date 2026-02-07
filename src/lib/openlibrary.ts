/**
 * OpenLibrary API client for book and author enrichment
 * Rate limited to ~100 requests per minute (600ms delay between calls)
 */

const RATE_LIMIT_MS = 600;
let lastRequestTime = 0;

/**
 * Rate-limited fetch with 600ms delay between requests
 */
async function rateLimitedFetch(url: string): Promise<any> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;

  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }

  lastRequestTime = Date.now();

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Search for a book by ISBN
 * Primary lookup method - most reliable
 */
export async function searchByISBN(isbn: string): Promise<any | null> {
  if (!isbn) return null;

  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;

  try {
    const data = await rateLimitedFetch(url);
    return data[`ISBN:${isbn}`] || null;
  } catch (error) {
    console.error(`Error fetching ISBN ${isbn}:`, error);
    return null;
  }
}

/**
 * Search for a book by title and author
 * Fallback method when ISBN is not available
 */
export async function searchByTitleAuthor(
  title: string,
  author?: string
): Promise<any | null> {
  const encodedTitle = encodeURIComponent(title);
  const encodedAuthor = author ? encodeURIComponent(author) : '';
  const authorParam = encodedAuthor ? `&author=${encodedAuthor}` : '';

  const url = `https://openlibrary.org/search.json?title=${encodedTitle}${authorParam}&limit=1`;

  try {
    const data = await rateLimitedFetch(url);
    return data.docs?.[0] || null;
  } catch (error) {
    console.error(`Error searching for "${title}":`, error);
    return null;
  }
}

/**
 * Get author details by OpenLibrary ID
 */
export async function getAuthor(olid: string): Promise<any | null> {
  if (!olid) return null;

  const url = `https://openlibrary.org/authors/${olid}.json`;

  try {
    return await rateLimitedFetch(url);
  } catch (error) {
    console.error(`Error fetching author ${olid}:`, error);
    return null;
  }
}

/**
 * Build a cover image URL for a book
 * @param isbn - The ISBN of the book
 * @param size - 'S' (small), 'M' (medium), or 'L' (large)
 */
export function getCoverUrl(
  isbn: string,
  size: 'S' | 'M' | 'L' = 'L'
): string | null {
  if (!isbn) return null;
  return `https://covers.openlibrary.org/b/isbn/${isbn}-${size}.jpg`;
}

/**
 * Build an author photo URL
 * @param photoId - The OpenLibrary photo ID (numeric)
 * @param size - 'S' (small), 'M' (medium), or 'L' (large)
 * 
 * Note: Use /a/id/ for numeric photo IDs, /a/olid/ is for author OLIDs
 */
export function getAuthorPhotoUrl(
  photoId: number,
  size: 'S' | 'M' | 'L' = 'L'
): string | null {
  if (!photoId) return null;
  return `https://covers.openlibrary.org/a/id/${photoId}-${size}.jpg`;
}

/**
 * Extract clean text from description (handles HTML or plain string)
 */
export function extractDescription(description: any): string | null {
  if (!description) return null;

  if (typeof description === 'string') {
    return description.trim() || null;
  }

  if (typeof description === 'object' && description.value) {
    return description.value.trim() || null;
  }

  return null;
}

/**
 * Extract the OpenLibrary work ID from various response formats
 */
export function extractOpenLibraryId(data: any): string | null {
  if (!data) return null;

  // From books API: /works/OL12345W -> OL12345W
  if (data.key && data.key.includes('/works/')) {
    return data.key.replace('/works/', '');
  }

  // From search API: may have different format
  if (data.id_works && Array.isArray(data.id_works) && data.id_works.length > 0) {
    return String(data.id_works[0]);
  }

  // Direct ID
  if (data.openLibraryId) {
    return data.openLibraryId;
  }

  return null;
}

/**
 * Extract author OpenLibrary ID
 */
export function extractAuthorId(data: any): string | null {
  if (!data) return null;

  if (data.key && data.key.includes('/authors/')) {
    return data.key.replace('/authors/', '');
  }

  if (data.id_authors && Array.isArray(data.id_authors) && data.id_authors.length > 0) {
    return String(data.id_authors[0]);
  }

  return null;
}

/**
 * Search for authors by name
 * Returns the best match author from search results
 */
export async function searchAuthorsByName(name: string): Promise<any | null> {
  if (!name) return null;

  const encodedName = encodeURIComponent(name);
  const url = `https://openlibrary.org/search.json?author=${encodedName}&limit=5`;

  try {
    const data = await rateLimitedFetch(url);
    const docs = data.docs || [];

    // Find best match by exact name or close match
    for (const doc of docs) {
      // Check if author_name matches closely
      if (doc.author_name && Array.isArray(doc.author_name)) {
        const authorName = doc.author_name[0].toLowerCase();
        const searchName = name.toLowerCase();

        // Exact match or last name match
        if (authorName === searchName ||
            searchName.includes(authorName) ||
            authorName.includes(searchName.split(' ').pop() || '')) {
          // Extract OLID from first author key
          if (doc.author_key && doc.author_key.length > 0) {
            return {
              olid: doc.author_key[0].replace('/authors/', ''),
              name: doc.author_name[0],
              matchScore: doc.score || 0
            };
          }
        }
      }
    }

    // Fallback: return first result if any
    if (docs.length > 0 && docs[0].author_key && docs[0].author_key.length > 0) {
      return {
        olid: docs[0].author_key[0].replace('/authors/', ''),
        name: docs[0].author_name?.[0] || name,
        matchScore: docs[0].score || 0
      };
    }

    return null;
  } catch (error) {
    console.error(`Error searching for author "${name}":`, error);
    return null;
  }
}
