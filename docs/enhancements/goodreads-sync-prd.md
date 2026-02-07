# PRD: Goodreads Sync Feature

**Date:** 2026-02-07
**Status:** Draft
**Author:** Jeeves (for Cheryl)

---

## Overview

A manual sync feature to update the library with changes from Goodreads CSV exports. Preserves enriched data while updating shelf status, date read, and adding new books with full enrichment.

## Goals

- Keep library in sync with Goodreads reading progress
- Only update shelf, date read, and read count for existing books
- Add new books with full author/cover/description enrichment
- Preserve all Phase 2 enrichment work

## Non-Goals

- Syncing ratings (Goodreads ratings ≠ personal ratings)
- Deleting books from library
- Automatic scheduled sync (manual trigger only)

---

## User Stories

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| 1 | User | download new Goodreads CSV export | I can update my library with latest progress |
| 2 | User | run a sync command | shelf status and date read are updated for existing books |
| 3 | User | new books from Goodreads are added with covers and author info | I don't have to manually enter book details |
| 4 | User | see a summary of what changed | I can verify the sync worked correctly |

---

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Load Goodreads CSV export | Must |
| FR-2 | Match existing books by ISBN (primary) | Must |
| FR-3 | Fallback match by title + author fuzzy match | Should |
| FR-4 | Update existing books: shelf, dateRead, readCount | Must |
| FR-5 | Preserve: coverUrl, description, author, enrichedAt | Must |
| FR-6 | Add new books with full enrichment (OL → GB) | Must |
| FR-7 | Skip excluded titles | Must |
| FR-8 | Print summary of changes | Should |

### Data Mapping

| Goodreads Field | → | Library Field | Notes |
|----------------|---|---------------|-------|
| `Exclusive Shelf` | → | `shelf` | read → READ, currently-reading → CURRENTLY_READING, to-read → TO_READ |
| `Date Read` | → | `dateRead` | |
| `Read Count` | → | `readCount` | |
| `Average Rating` | → | `averageRating` | Enrichment only, not synced |
| `My Rating` | → | `myRating` | NOT synced from Goodreads |

### Fields NOT synced from Goodreads
- `My Rating` (personal ratings differ)
- `My Review` (if library has reviews, preserve them)

### Fields preserved on existing books
- `coverUrl`
- `description`
- `author` relationships
- `enrichedAt`
- `seriesId`

---

## Data Normalization (from original import)

| Field | Normalization |
|-------|--------------|
| Title | Parse series info from format `(Series, #N)` |
| Authors | Handle "Last, First" format, multiple authors |
| ISBN | Remove hyphens, validate length (10 or 13) |
| Shelf | Map: read → READ, currently-reading → CURRENTLY_READING, to-read → TO_READ |
| Exclusion list | Load from `excluded-titles.json` |

---

## Technical Approach

### New Script: `scripts/sync-goodreads.ts`

```typescript
interface SyncResult {
  matchedByIsbn: number;
  matchedByTitle: number;
  updated: number;
  added: number;
  skipped: number;
  errors: number;
}

async function syncGoodreads(csvPath: string): Promise<SyncResult> {
  // 1. Load CSV
  const books = loadGoodreadsCsv(csvPath);
  
  // 2. Get existing ISBNs for matching
  const existingBooks = await prisma.book.findMany({
    select: { id: true, isbn: true, isbn13: true, title: true }
  });
  
  // Build ISBN → book map
  const isbnMap = new Map<string, string>();
  existingBooks.forEach(b => {
    if (b.isbn) isbnMap.set(b.isbn, b.id);
    if (b.isbn13) isbnMap.set(b.isbn13, b.id);
  });
  
  // 3. Process each Goodreads book
  for (const grBook of books) {
    // Check exclusion
    if (isExcluded(grBook.title)) {
      skipped++;
      continue;
    }
    
    // Try ISBN match
    const isbn = normalizeIsbn(grBook.isbn);
    const isbn13 = normalizeIsbn(grBook.isbn13);
    const bookId = isbnMap.get(isbn) || isbnMap.get(isbn13);
    
    if (bookId) {
      // Update existing
      await updateBookStatus(bookId, grBook);
      matchedByIsbn++;
    } else {
      // Fuzzy match by title + author
      const candidate = findBestTitleMatch(grBook, existingBooks);
      if (candidate) {
        await updateBookStatus(candidate.id, grBook);
        matchedByTitle++;
      } else {
        // Add new book with enrichment
        await addNewBookWithEnrichment(grBook);
        added++;
      }
    }
  }
  
  return { matchedByIsbn, matchedByTitle, updated, added, skipped, errors };
}
```

### Enrichment Pipeline (for new books)

Same as Phase 2 - all enrichment included inline:

| Step | Source | Priority | Notes |
|------|--------|----------|-------|
| **Cover** | OpenLibrary | Primary | Validate: size >15KB, aspect ratio 1.2-2.0, min 150x200 |
| Cover | Google Books | Fallback | Zoom=2, HTTPS |
| **Description** | Google Books API | Primary | Search by title+author |
| **Author Bio** | OpenLibrary | Primary | Author search → bio field |
| Author Photo | OpenLibrary | Primary | photos array → best ID |
| **Series** | OpenLibrary | Enrichment | Search by name → bookCount, openLibrarySlug |
| **Authors** | Name parsing | Built-in | Handle "Last, First", multiple authors |

### Rate Limiting
- OpenLibrary: 600ms between requests
- Google Books: 600ms between requests

### Placeholder Detection
- Skip 43-byte files (OpenLibrary 1x1 GIF)
- Skip 15,567-byte files (Google Books "image not available" PNG)

---

## Usage

```bash
# Dry run first (recommended)
npx tsx scripts/sync-goodreads.ts --dry

# Run sync with automatic backup
npx tsx scripts/sync-goodreads.ts

# With custom CSV path
npx tsx scripts/sync-goodreads.ts --csv=/path/to/export.csv

# Skip backup (not recommended for production)
npx tsx scripts/sync-goodreads.ts --no-backup
```

### Backup Behavior
- **Location:** `~/clawd/brain/projects/my-library/backups/`
- **Format:** `my-library-backup-YYYY-MM-DDTHH-mm-ss.sql`
- **Retention:** Keeps last 5 backups (rotates old ones)
- **Skippable:** Use `--no-backup` flag

### Output Example

```
📚 Goodreads Sync with FULL ENRICHMENT
   Mode: LIVE
   CSV: /Users/cheryl/clawd/brain/projects/my-library/goodreads-library.csv
   Enrichment: ENABLED
   Backup: ENABLED

💾 Creating database backup...
   ✅ Backup created: .../backups/my-library-backup-2026-02-07T12-28-00.sql (2.34 MB)
   🗑️  Rotated out old backup: my-library-backup-2026-02-01T10-00-00.sql

📖 Loaded 1,742 books from Goodreads

📚 Found 1,650 existing books in library
...
📊 Summary:
   🔗 Matched ISBN:   1,523
   🔗 Matched Title:  127
   ✅ Updated:       1,523
   ✨ Added:          92
   ⛔ Excluded:       0
   ❌ Errors:        0

✅ Sync complete!
```

### Emergency Restore
If something goes wrong:

```bash
# List available backups
ls ~/clawd/brain/projects/my-library/backups/

# Restore from backup
psql "DATABASE_URL" < ~/clawd/brain/projects/my-library/backups/my-library-backup-YYYY-MM-DDTHH-mm-ss.sql
```

---

## CSV Format (Standard Goodreads Export)

| Column | Example |
|--------|---------|
| Title | "The Name of the Wind" |
| Author | "Patrick Rothfuss" |
| Additional Authors | "" |
| ISBN | "9780750687178" |
| ISBN13 | "9780750687178" |
| Average Rating | "4.50" |
| My Rating | "5" |
| Number of Pages | "722" |
| Original Publication Year | "2007" |
| Publisher | "Bloomsbury Publishing" |
| Binding | "Hardcover" |
| Date Read | "2024/01/15" |
| Read Count | "2" |
| Exclusive Shelf | "read" |
| My Review | "" |
| Bookshelves | "fantasy, favorites" |
| Private Notes | "" |

---

## Implementation Plan

### Phase 1: Script Development
- [ ] Create `sync-goodreads.ts` script
- [ ] Reuse normalization functions from `utils.ts`
- [ ] Implement ISBN matching
- [ ] Implement fuzzy title matching
- [ ] Implement new book enrichment

### Phase 2: Testing
- [ ] Dry run mode verification
- [ ] Test with sample CSV
- [ ] Verify enriched data is preserved

### Phase 3: Documentation
- [ ] Update README with sync instructions
- [ ] Document CSV export steps

---

## Future Enhancements (Out of Scope)

- Scheduled automatic sync
- Sync to multiple libraries
- Selective field sync
- Import Goodreads reviews
- Merge Goodreads shelves with library shelves

---

## References

- Original import: `scripts/import-goodreads.ts`
- Utilities: `scripts/utils.ts`
- Phase 2 enrichment: `scripts/enrich-covers-v3.ts`
- Exclusion list: `clawd/brain/projects/my-library/excluded-titles.json`
