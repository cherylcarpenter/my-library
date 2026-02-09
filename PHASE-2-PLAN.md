# Phase 2: Enrichment — Detailed Plan

*Created: 2026-02-04*
*Last Updated: 2026-02-06*

---

## Overview

Phase 2 enriches book and author data using the OpenLibrary + Google Books APIs. This includes fetching cover images, book descriptions, and author bios for books that are missing this information.

---

## Current Status (2026-02-06)

### ✅ Phase 2 COMPLETED

| Task | Status | Notes |
|------|--------|-------|
| OpenLibrary service (`src/lib/openlibrary.ts`) | ✅ Done | Rate-limited, comprehensive helper functions |
| Google Books service (`src/lib/googlebooks.ts`) | ✅ Done | Author validation, fallback API |
| Cover enrichment script | ✅ Done | 93 covers found, ~10 still missing |
| Cover enrichment API endpoint | ✅ Done | `/api/covers` for fetching missing covers |
| Genre → Category refactor | ✅ Done | 1,835 granular subjects → 15 categories |
| Author bibliography | ✅ Done | Shows all works from OpenLibrary on author pages |
| Filter improvements | ✅ Done | Format dropdown, active filter indicator |
| Default sort → Recently Read | ✅ Done | Changed from Recently Added |
| Description enrichment | ✅ Done | ~700 books enriched (40% coverage) |
| Book detail page update | ✅ Done | HTML stripping, displays descriptions |
| Author bio enrichment | ✅ Done | ~227 authors enriched (photos + bios) |
| Author detail page update | ✅ Done | HTML stripping, displays bios/photos |
| Author validation | ✅ Done | Prevents wrong covers (e.g., "The Chateau" issue) |

### 📊 Final Data Stats

- **Total books:** 1,742
- **Books with covers:** 1,732 (~99.4%)
- **Books with descriptions:** ~700 (40%)
- **Authors with bios:** ~560+ (37%)
- **Authors with photos:** ~660+ (44%)

### 📈 Coverage Improvements

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Books with descriptions | 492 (28%) | ~700 (40%) | +208 (+42%) |
| Authors with bios | 495 (33%) | ~560+ (37%) | +65 (+13%) |
| Authors with photos | ~600 (40%) | ~660+ (44%) | +60 (+10%) |

---

## Scripts Created

| Script | Purpose | Usage |
|--------|---------|-------|
| `scripts/enrich-books.ts` | Combined OL + GB with author validation | `npx tsx scripts/enrich-books.ts` |
| `scripts/enrich-authors-google.ts` | Fast Google Books author enrichment | `npx tsx scripts/enrich-authors-google.ts` |
| `scripts/enrich-covers.ts` | Find missing covers | `npx tsx scripts/enrich-covers.ts` |

---

## API Comparison

| API | Entries | Cost | Descriptions | Covers | Best For |
|-----|---------|------|--------------|--------|----------|
| **OpenLibrary** | 40M+ | Free | ~28% of books | ✅ | Primary source |
| **Google Books** | 40M | Free | ~12% more | ✅ | Fallback, better author data |

**Strategy:** Use OpenLibrary first, Google Books as fallback. Validate author names before accepting matches.

---

## Remaining Gaps

Despite enrichment:
- **~60% of books** have no descriptions (not in APIs)
- **~63% of authors** have no bios (no ISBNs or not in databases)
- Some books have **wrong covers** despite validation (edge cases)

**Root causes:**
- 7.6% have no ISBN and no OpenLibrary ID
- Many older/obscure/self-published works aren't in the databases
- Author name variations cause mismatches

---

## Success Criteria ✅

- [x] 40%+ of books have descriptions
- [x] 30%+ of authors have bios
- [x] Book detail pages show descriptions
- [x] Author pages show bios and photos
- [x] All enrichment scripts are idempotent

---

## Future Improvements (Phase 2b)

See `PHASE-2B-PLAN.md` for:
- ISBNDB paid API integration for better coverage
- Manual enrichment workflow for edge cases
- Cover validation / manual approval UI

---

*Phase 2 complete! Phase 2b awaits...*

---

## OpenLibrary API Reference

### Endpoints We'll Use

| API | URL Pattern | Purpose |
|-----|-------------|---------|
| **Books API** | `https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data` | Get book data by ISBN |
| **Covers API** | `https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg` | Get cover image by ISBN |
| **Search API** | `https://openlibrary.org/search.json?title={title}&author={author}` | Fallback when no ISBN |
| **Authors API** | `https://openlibrary.org/authors/{olid}.json` | Get author bio by OpenLibrary ID |

### Rate Limits
- OpenLibrary requests: **100/minute recommended** (no hard limit but be respectful)
- We'll implement 600ms delay between requests (~100/min)

### Data Available
- **Cover images**: S (small), M (medium), L (large) sizes
- **Descriptions**: Often available, sometimes HTML formatted
- **Author bios**: Available for many authors, includes birth/death dates
- **Subjects/Genres**: Available for categorization (already used for categories)

---

## Database Schema Updates

✅ Schema already has enrichment fields:
- `Book.openLibraryId`
- `Book.description` (@db.Text)
- `Book.enrichedAt`
- `Book.enrichmentStatus`
- `Author.openLibraryId`
- `Author.bio` (@db.Text)
- `Author.photoUrl`
- `Author.enrichedAt`

---

## Remaining Tasks

### 1. Description Enrichment Script (HIGH PRIORITY)
- Create `scripts/enrich-descriptions.ts`
- For each book without a description:
  - Try ISBN lookup first
  - Fallback to title+author search
  - Extract description
  - Update database
- **Expected: ~500-800 books have descriptions available**

### 2. Author Bio Enrichment Script (MEDIUM PRIORITY)
- Create `scripts/enrich-author-bios.ts`
- For each author without a bio:
  - Find OpenLibrary ID from enriched books
  - Fetch author details
  - Extract bio, photo, birth/death dates
  - Update database
- **Expected: ~300-500 authors have bios available**

### 3. Book Detail Page Update
- Update `/books/[slug]/page.tsx` to show description
- Handle HTML in descriptions (sanitize or strip tags)
- Show placeholder if no description

### 4. Author Detail Page Update
- Update `/authors/[slug]/page.tsx` to show bio
- Show author photo if available
- Handle HTML in bio

---

## Scripts Available

| Script | Purpose | Status |
|--------|---------|--------|
| `scripts/enrich-covers.ts` | Find missing covers | ✅ Done |
| `scripts/enrich-books.ts` | Book enrichment (old) | ⚠️ Needs update |
| `scripts/enrich-authors.ts` | Author enrichment (old) | ⚠️ Needs update |
| `scripts/map-genres-to-categories.ts` | Genre → Category | ✅ Done |

---

## Technical Details

### OpenLibrary Service (`src/lib/openlibrary.ts`)

✅ Already implemented with:
- Rate-limited fetcher (600ms delay)
- `searchByISBN(isbn)` - primary lookup
- `searchByTitleAuthor(title, author)` - fallback
- `getAuthor(olid)` - author details
- `getCoverUrl(isbn)` - cover URL builder
- `extractDescription()` - handles HTML/plain text
- `extractOpenLibraryId()` / `extractAuthorId()`

---

## Next Steps

1. **Run description enrichment** (today)
   ```bash
   npx tsx scripts/enrich-descriptions.ts
   ```

2. **Update book detail page** to show description

3. **Run author bio enrichment**

4. **Update author detail page** to show bio/photo

---

## Estimated Timeline

| Task | Time |
|------|------|
| Description enrichment script + run | 1-2 hrs |
| Author bio enrichment script + run | 1 hr |
| Book detail page update | 30 min |
| Author detail page update | 30 min |
| **Total remaining** | **3-4 hrs** |

---

## Success Criteria

- [ ] 50%+ of books have descriptions
- [ ] 30%+ of authors have bios
- [ ] Book detail pages show descriptions
- [ ] Author pages show bios and photos
- [ ] All enrichment scripts are idempotent (can re-run)

---

*Phase 2 continues...*