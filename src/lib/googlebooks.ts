/**
 * Google Books API client for book enrichment
 * Free API with rate limits (~100 requests/second by IP)
 */

const RATE_LIMIT_MS = 100; // Conservative: 100ms between requests
let lastRequestTime = 0;

/**
 * Rate-limited fetch
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
 */
export async function searchByISBN(isbn: string): Promise<any | null> {
  if (!isbn) return null;

  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`;

  try {
    const data = await rateLimitedFetch(url);
    return data.items?.[0]?.volumeInfo || null;
  } catch (error) {
    console.error(`Google Books error for ISBN ${isbn}:`, error);
    return null;
  }
}

/**
 * Search for a book by title and author
 */
export async function searchByTitleAuthor(
  title: string,
  author?: string
): Promise<any | null> {
  const query = author 
    ? `intitle:${title} inauthor:${author}`
    : `intitle:${title}`;
  
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5`;

  try {
    const data = await rateLimitedFetch(url);
    return data.items?.[0]?.volumeInfo || null;
  } catch (error) {
    console.error(`Google Books error searching "${title}":`, error);
    return null;
  }
}

/**
 * Get the best match from multiple results with author validation
 */
export async function searchWithAuthorValidation(
  title: string,
  targetAuthor: string
): Promise<any | null> {
  if (!title) return null;

  const query = `intitle:${title}`;
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=10`;

  try {
    const data = await rateLimitedFetch(url);
    const items = data.items || [];

    if (items.length === 0) return null;

    // Find the best match by comparing authors
    let bestMatch = null;
    let bestScore = 0;

    for (const item of items) {
      const volumeInfo = item.volumeInfo;
      const authors = volumeInfo.authors || [];
      const bookTitle = volumeInfo.title || '';

      // Calculate match score
      let score = 0;

      // Check if any author name matches (fuzzy match)
      const targetAuthorLower = targetAuthor.toLowerCase();
      for (const author of authors) {
        const authorLower = author.toLowerCase();
        
        // Exact match
        if (authorLower === targetAuthorLower) {
          score = 100;
          break;
        }
        // Last name match (e.g., "John Smith" matches "Smith")
        const targetLastName = targetAuthorLower.split(' ').pop();
        const authorLastName = authorLower.split(' ').pop();
        if (targetLastName && authorLastName === targetLastName) {
          score = Math.max(score, 50);
        }
        // Partial match
        if (authorLower.includes(targetAuthorLower) || targetAuthorLower.includes(authorLower)) {
          score = Math.max(score, 30);
        }
      }

      // Title match bonus
      if (bookTitle.toLowerCase().includes(title.toLowerCase())) {
        score += 10;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = volumeInfo;
      }
    }

    return bestScore >= 30 ? bestMatch : null;
  } catch (error) {
    console.error(`Google Books error searching "${title}":`, error);
    return null;
  }
}

/**
 * Build a cover URL from Google Books thumbnail
 */
export function getCoverUrl(thumbnail?: string): string | null {
  if (!thumbnail) return null;
  // Convert to larger image
  return thumbnail.replace('zoom=1', 'zoom=2').replace('http://', 'https://');
}

/**
 * Extract clean description from Google Books
 */
export function extractDescription(
  description?: string,
  authors?: string[]
): { description: string | null; authorMatch: boolean } {
  return {
    description: description?.trim() || null,
    authorMatch: !!(authors && authors.length > 0)
  };
}
