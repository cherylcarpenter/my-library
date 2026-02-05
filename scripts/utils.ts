/**
 * Shared utilities for import scripts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// Path to exclusion list
const EXCLUDED_TITLES_PATH = join(
  process.env.HOME || '',
  'clawd/brain/projects/my-library/excluded-titles.json'
);

// Load exclusion list
let excludedTitles: string[] = [];
try {
  const data = JSON.parse(readFileSync(EXCLUDED_TITLES_PATH, 'utf-8'));
  excludedTitles = data.excludedTitles.map((t: string) => normalizeTitle(t));
  console.log(`📋 Loaded ${excludedTitles.length} excluded titles`);
} catch (e) {
  console.warn('⚠️  Could not load exclusion list, proceeding without filtering');
}

/**
 * Generate URL-friendly slug from text
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Spaces to hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, ''); // Trim hyphens from ends
}

/**
 * Normalize title for comparison (lowercase, remove punctuation, trim)
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if a title should be excluded
 */
export function isExcluded(title: string): boolean {
  const normalized = normalizeTitle(title);
  return excludedTitles.some(excluded => 
    normalized.includes(excluded) || excluded.includes(normalized)
  );
}

/**
 * Parse series info from title like "Book Title (Series Name, #3)"
 * Returns { cleanTitle, seriesName, seriesOrder } or null values if no series
 */
export function parseSeries(title: string): {
  cleanTitle: string;
  seriesName: string | null;
  seriesOrder: number | null;
} {
  // Match patterns like "(Series Name, #3)" or "(Series Name #3)" or "(Series, Book 3)"
  const seriesPatterns = [
    /^(.+?)\s*\(([^,]+),?\s*#?(\d+(?:\.\d+)?)\)$/,  // "Title (Series, #3)"
    /^(.+?)\s*\(([^,]+),?\s*Book\s*(\d+(?:\.\d+)?)\)$/i,  // "Title (Series, Book 3)"
    /^(.+?)\s*\(([^)]+)\s+#(\d+(?:\.\d+)?)\)$/,  // "Title (Series #3)"
  ];

  for (const pattern of seriesPatterns) {
    const match = title.match(pattern);
    if (match) {
      return {
        cleanTitle: match[1].trim(),
        seriesName: match[2].trim(),
        seriesOrder: parseFloat(match[3]),
      };
    }
  }

  // Check for series at end without parentheses: "Title: Series Book 3"
  const colonPattern = /^(.+?):\s*(.+?)\s+(?:Book\s+)?#?(\d+(?:\.\d+)?)$/i;
  const colonMatch = title.match(colonPattern);
  if (colonMatch) {
    // Only use this if the "series" part looks like a series name (short-ish)
    if (colonMatch[2].length < 50) {
      return {
        cleanTitle: colonMatch[1].trim(),
        seriesName: colonMatch[2].trim(),
        seriesOrder: parseFloat(colonMatch[3]),
      };
    }
  }

  return {
    cleanTitle: title,
    seriesName: null,
    seriesOrder: null,
  };
}

/**
 * Parse author string, handling multiple authors
 * Returns array of author names
 */
export function parseAuthors(authorString: string, additionalAuthors?: string | null): string[] {
  const authors: string[] = [];
  
  // Primary author
  if (authorString) {
    // Handle "Last, First" format
    if (authorString.includes(',') && !authorString.includes(' and ')) {
      const parts = authorString.split(',').map(p => p.trim());
      if (parts.length === 2 && !parts[1].includes(',')) {
        authors.push(`${parts[1]} ${parts[0]}`);
      } else {
        authors.push(authorString);
      }
    } else {
      // Handle "Author One, Author Two" or "Author One and Author Two"
      const splitAuthors = authorString
        .split(/,\s*(?:and\s+)?|(?:\s+and\s+)/i)
        .map(a => a.trim())
        .filter(a => a.length > 0);
      authors.push(...splitAuthors);
    }
  }

  // Additional authors
  if (additionalAuthors) {
    const additional = additionalAuthors
      .split(/,\s*/)
      .map(a => a.trim())
      .filter(a => a.length > 0);
    authors.push(...additional);
  }

  return [...new Set(authors)]; // Dedupe
}

/**
 * Map Goodreads shelf to our Shelf enum
 */
export function mapShelf(exclusiveShelf: string): 'READ' | 'CURRENTLY_READING' | 'TO_READ' {
  switch (exclusiveShelf) {
    case 'read':
      return 'READ';
    case 'currently-reading':
      return 'CURRENTLY_READING';
    case 'to-read':
    default:
      return 'TO_READ';
  }
}

/**
 * Normalize ISBN (remove hyphens, validate length)
 */
export function normalizeIsbn(isbn: string | null | undefined): string | null {
  if (!isbn) return null;
  const cleaned = isbn.replace(/[-\s]/g, '');
  if (cleaned.length === 10 || cleaned.length === 13) {
    return cleaned;
  }
  return null;
}

/**
 * Calculate similarity between two strings (for fuzzy matching)
 * Returns 0-1 score
 */
export function similarity(a: string, b: string): number {
  const s1 = normalizeTitle(a);
  const s2 = normalizeTitle(b);
  
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  // Simple approach: check if one contains the other
  if (s1.includes(s2) || s2.includes(s1)) {
    return 0.9;
  }

  // Levenshtein-based similarity
  const maxLen = Math.max(s1.length, s2.length);
  const distance = levenshtein(s1, s2);
  return 1 - distance / maxLen;
}

/**
 * Levenshtein distance
 */
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Ensure unique slug by appending number if needed
 */
export function makeUniqueSlug(baseSlug: string, existingSlugs: Set<string>): string {
  let slug = baseSlug;
  let counter = 2;
  while (existingSlugs.has(slug)) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
  existingSlugs.add(slug);
  return slug;
}

// Stats tracking
export interface ImportStats {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  excluded: number;
  errors: number;
}

export function createStats(): ImportStats {
  return { processed: 0, created: 0, updated: 0, skipped: 0, excluded: 0, errors: 0 };
}

export function printStats(label: string, stats: ImportStats): void {
  console.log(`\n📊 ${label} Stats:`);
  console.log(`   Processed: ${stats.processed}`);
  console.log(`   Created:   ${stats.created}`);
  console.log(`   Updated:   ${stats.updated}`);
  console.log(`   Skipped:   ${stats.skipped}`);
  console.log(`   Excluded:  ${stats.excluded}`);
  console.log(`   Errors:    ${stats.errors}`);
}
