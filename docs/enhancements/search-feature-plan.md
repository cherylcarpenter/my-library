# Search Feature Plan — Typeahead Search in Header

## Context

The library app currently has no search functionality. Users must browse via navigation links and filters. Adding a typeahead search box in the header will let users quickly find books by title or authors by name from any page.

## Key Decisions

- **Search scope:** My library only — books must have a UserBook entry to appear in results
- **Results UX:** Typeahead dropdown links to detail pages + a dedicated `/search` results page accessible via "View all results"

## Approach: PostgreSQL Full-Text Search with Typeahead UI

**Why PostgreSQL FTS over Elasticsearch:**
- Already running on Neon PostgreSQL — zero new infrastructure
- Supports prefix matching (`to_tsquery('prefix:*')`) ideal for typeahead
- Supports relevance ranking via `ts_rank`
- Handles stemming (e.g., "running" matches "run")
- More than sufficient for a personal library (not millions of records)
- Elasticsearch would require a separate service, deployment, syncing — overkill here

## Implementation Steps

### 1. Database: Add full-text search indexes (Prisma migration)

**File:** `prisma/schema.prisma` — no schema changes needed (raw SQL migration)

Create a new Prisma migration with raw SQL to add:
- A `search_vector` column (type `tsvector`) on the `Book` table combining `title`
- A `search_vector` column on the `Author` table on `name`
- GIN indexes on both columns for fast search
- Triggers to auto-update `search_vector` on INSERT/UPDATE

```sql
-- Book search vector
ALTER TABLE "Book" ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, ''))) STORED;
CREATE INDEX book_search_idx ON "Book" USING GIN (search_vector);

-- Author search vector
ALTER TABLE "Author" ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(name, ''))) STORED;
CREATE INDEX author_search_idx ON "Author" USING GIN (search_vector);
```

### 2. API: Create `/api/search` endpoint

**New file:** `src/app/api/search/route.ts`

- Accept `q` query parameter (the search term)
- Accept optional `limit` parameter (default 5 per type for typeahead)
- Use Prisma `$queryRaw` for full-text search queries
- **Books:** JOIN with `UserBook` to only return books in the user's library; include author names
- **Authors:** Only return authors who have at least one book in the user's library
- Search both in parallel
- For typeahead, use prefix matching: `to_tsquery('english', 'term:*')`
- Return combined results grouped by type:

```json
{
  "books": [{ "title", "slug", "coverUrl", "authors": [...] }],
  "authors": [{ "name", "slug", "photoUrl", "bookCount" }]
}
```

- Minimum query length: 2 characters
- Results ranked by `ts_rank` relevance score
- Accept `page` param for full results page pagination

### 3. UI: Create `SearchBox` component

**New file:** `src/components/layout/SearchBox/index.tsx`
**New file:** `src/components/layout/SearchBox/styles.module.scss`

Client component (`'use client'`) with:
- Text input with search icon and placeholder "Search books & authors..."
- Debounced input (300ms) to avoid excessive API calls
- Dropdown results panel showing:
  - **Books section:** cover thumbnail, title, author name(s) — links to `/books/[slug]`
  - **Authors section:** photo thumbnail, name, book count — links to `/authors/[slug]`
  - "No results found" state
  - Loading spinner while fetching
- Keyboard navigation (arrow keys, Enter to select, Escape to close)
- Click outside to close dropdown
- "View all results" link at bottom of dropdown → navigates to `/search?q=...`
- On mobile: collapses to a search icon that expands the input

### 4. Search Results Page

**New file:** `src/app/search/page.tsx`
**New file:** `src/app/search/styles.module.scss`

- Full search results page at `/search?q=...`
- Server component that fetches from `/api/search` with higher limit
- Shows books and authors in organized sections
- Reuses existing book card and author card patterns from `/books` and `/authors` pages
- Pagination for large result sets
- Shows the search query prominently at top

### 5. Header Integration

**Modify:** `src/components/layout/Header/index.tsx`
- Import and render `<SearchBox />` between the `<nav>` and the auth/user section
- This places it naturally on the right side of the header

**Modify:** `src/components/layout/Header/styles.module.scss`
- Add flex layout adjustments so the search box sits between nav and auth
- On mobile: search icon in header bar, expanding input on tap

## Files to Create/Modify

| File | Action |
|------|--------|
| `prisma/migrations/[timestamp]_add_search_vectors/migration.sql` | Create (via `prisma migrate`) |
| `src/app/api/search/route.ts` | Create |
| `src/components/layout/SearchBox/index.tsx` | Create |
| `src/components/layout/SearchBox/styles.module.scss` | Create |
| `src/app/search/page.tsx` | Create |
| `src/app/search/styles.module.scss` | Create |
| `src/components/layout/Header/index.tsx` | Modify — add SearchBox |
| `src/components/layout/Header/styles.module.scss` | Modify — layout adjustments |

## Styling Notes

- Follow existing pattern: SCSS modules with design tokens from `variables.scss`
- Match header's brown theme (`$color-primary: #8B5A2B`)
- Input styling: subtle border, rounded corners, focus ring in primary color
- Dropdown: elevated surface with shadow, matching the app's card aesthetic
- Mobile: search icon button that expands to full-width input overlay

## Verification

1. Run `npx prisma migrate dev` to apply the search vector migration
2. Start dev server (`npm run dev`)
3. Type in the search box — verify results appear after 2+ characters
4. Test searching by book title and by author name
5. Click a result — verify it navigates to the correct detail page
6. Test keyboard navigation (arrows, Enter, Escape)
7. Test mobile responsive behavior (resize browser)
8. Test edge cases: empty query, no results, special characters
