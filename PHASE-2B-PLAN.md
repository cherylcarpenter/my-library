# Phase 2b: Advanced Enrichment (Free Only)

*Created: 2026-02-06*

---

## Overview

Phase 2b addresses remaining gaps using **free methods only**. Skip paid APIs — $10+/mo for 1,742 books is poor ROI.

---

## Current Gaps

| Gap | Count | % | Root Cause |
|-----|-------|---|------------|
| Books without descriptions | ~1,042 | 60% | Not in OpenLibrary/Google Books |
| Authors without bios | ~946 | 63% | No ISBNs or not in databases |
| Books without ISBNs | 133 | 7.6% | Can't be enriched automatically |
| Wrong cover matches | ~few | - | Author name variations |

---

## Free Strategies Only

### Strategy 1: Fuzzy Author Matching

Fix wrong cover matches like "The Chateau by Avery Bishop" matching wrong author.

**Tasks:**
- Add `scripts/fuzzy-match.ts` with Levenshtein distance
- Update `enrich-books.ts` to reject low-confidence matches
- Goal: <1% wrong matches

### Strategy 2: Title-Based Enrichment

For books without ISBNs, search by title + author:

```bash
npx tsx scripts/enrich-books-by-title.ts
```

### Strategy 3: Re-Run Existing Scripts

Some books may now match since we enriched their authors:
```bash
npx tsx scripts/enrich-books.ts --limit=500
npx tsx scripts/enrich-authors-google.ts --limit=500
```

### Strategy 4: Manual (Selective Only)

For high-priority books only (favorites, series):
- Manual search on Google Books website
- Copy-paste description
- No dashboard needed for 10-20 books

---

## Recommended Approach

1. **Fuzzy matching** — Fix wrong covers (2-4 hrs)
2. **Title-based search** — For ISBN-missing books (2 hrs)
3. **Accept ~40%** as realistic ceiling with free APIs
4. **Skip paid APIs** — Not worth $10+/mo for this scale

---

## Implementation Tasks

| Script | Purpose | Time |
|--------|---------|------|
| `scripts/fuzzy-match.ts` | Levenshtein distance for names | 2 hrs |
| `scripts/enrich-books-by-title.ts` | Fallback for missing ISBNs | 2 hrs |
| `scripts/re-enrich.ts` | Re-run on already-enriched authors | 1 hr |

---

## Success Criteria (Phase 2b)

- [ ] Wrong cover matches < 1%
- [ ] All books with ISBNs are enriched
- [ ] Fuzzy matching prevents obvious mismatches

---

## Timeline

| Task | Time | Cost |
|------|------|------|
| Fuzzy matching | 2-4 hrs | Free |
| Title-based enrichment | 2 hrs | Free |
| Re-enrich check | 1 hr | Free |
| **Total** | **5-7 hrs** | **Free** |

---

*Phase 2b: Free improvements only. Paid APIs not worth it for this scale.*
