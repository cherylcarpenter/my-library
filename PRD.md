# My Library - Product Requirements Document

*Last Updated: 2026-02-03*
*Version: 0.4*
*Status: Implementation — Phase 1 in progress (Data Import complete)*

---

## Overview

A personal book library web application that consolidates reading data from Goodreads, Kindle, and Audible into a single, browsable catalog. The app displays book covers, descriptions, ownership status, and author information—enriched with data from OpenLibrary API.

---

## Goals

1. **Unified View** — See all books across platforms in one place
2. **Ownership Clarity** — Know at a glance if a book is owned on Kindle, Audible, both, or neither
3. **Rich Metadata** — Display covers, descriptions, and author bios (via OpenLibrary)
4. **Personal Curation** — Admin can add, edit, or remove books from the collection
5. **Shareable** — Public-facing library others can browse

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 14+ (App Router) |
| UI | React 18+, Modular SCSS |
| Data Fetching | React Query (TanStack Query) |
| Auth | NextAuth.js |
| Database | **Vercel Postgres** (via Neon) + **Prisma ORM** |
| External API | OpenLibrary API |
| Deployment | Vercel |

### Database Recommendation: Vercel Postgres + Prisma

**Why Vercel Postgres (Neon)?**
- Native Vercel integration (zero config)
- Serverless-friendly (scales to zero)
- PostgreSQL = great for relational data (books ↔ authors ↔ ownership)
- Free tier: 256MB storage, sufficient for ~10k books
- Prisma has excellent Postgres support

**Alternatives considered:**
- *PlanetScale* — Good, but MySQL syntax; Postgres is more flexible
- *Supabase* — Overkill since we're using NextAuth separately
- *MongoDB* — NoSQL less ideal for relational book/author data

---

## Data Model

### Entity Relationship

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│   User   │────<│ Library  │────<│ UserBook │>────│   Book   │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                                   (shelf,rating,      │
                                    ownership)         │
                                                       │
                      ┌──────────┐                     │
                      │  Series  │────────────────────<┘
                      └──────────┘                     │
                                                       │
                      ┌──────────┐                     │
                      │  Author  │>───────────────────<┘
                      └──────────┘
```

**Key relationships:**
- User has many Libraries (multi-user ready)
- Library has many UserBooks (personal reading data)
- UserBook links Library ↔ Book (with shelf, rating, ownership)
- Book belongs to optional Series (with order)
- Book has many Authors (via BookAuthor join)

### Prisma Schema (Initial)

```prisma
// ============================================
// USER & AUTH (Multi-user ready)
// ============================================

model User {
  id                String      @id @default(cuid())
  email             String      @unique
  name              String?
  image             String?
  role              UserRole    @default(USER)
  
  // Relations
  accounts          Account[]
  sessions          Session[]
  libraries         Library[]
  
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt
}

model Account {
  id                String      @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?     @db.Text
  access_token      String?     @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?     @db.Text
  session_state     String?
  
  user              User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@unique([provider, providerAccountId])
}

model Session {
  id                String      @id @default(cuid())
  sessionToken      String      @unique
  userId            String
  expires           DateTime
  user              User        @relation(fields: [userId], references: [id], onDelete: Cascade)
}

enum UserRole {
  USER
  ADMIN
}

// ============================================
// LIBRARY (Per-user book collections)
// ============================================

model Library {
  id                String      @id @default(cuid())
  name              String      @default("My Library")
  slug              String      
  isPublic          Boolean     @default(true)
  
  // Owner
  userId            String
  user              User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  // Relations
  userBooks         UserBook[]
  
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt
  
  @@unique([userId, slug])
}

// ============================================
// BOOKS (Shared catalog)
// ============================================

model Book {
  id                    String      @id @default(cuid())
  title                 String
  slug                  String      @unique
  
  // Identifiers
  isbn                  String?
  isbn13                String?
  goodreadsId           String?     @unique
  openLibraryKey        String?
  
  // Metadata
  description           String?     @db.Text
  coverUrl              String?
  pages                 Int?
  yearPublished         Int?
  originalPublicationYear Int?
  publisher             String?
  binding               String?
  language              String?     @default("english")
  averageRating         Float?
  
  // Series
  seriesId              String?
  series                Series?     @relation(fields: [seriesId], references: [id])
  seriesOrder           Float?      // Float allows 1.5 for novellas, etc.
  
  // Relations
  authors               BookAuthor[]
  userBooks             UserBook[]
  
  // Timestamps
  createdAt             DateTime    @default(now())
  updatedAt             DateTime    @updatedAt
  
  @@index([seriesId])
  @@index([slug])
}

// ============================================
// USER-BOOK RELATIONSHIP (Personal data)
// ============================================

model UserBook {
  id                String      @id @default(cuid())
  
  // Relations
  libraryId         String
  library           Library     @relation(fields: [libraryId], references: [id], onDelete: Cascade)
  bookId            String
  book              Book        @relation(fields: [bookId], references: [id], onDelete: Cascade)
  
  // Reading Status
  shelf             Shelf       @default(TO_READ)
  dateRead          DateTime?
  dateAdded         DateTime    @default(now())
  readCount         Int         @default(0)
  
  // Personal Rating & Review
  myRating          Int?        // 1-5
  myReview          String?     @db.Text
  privateNotes      String?     @db.Text
  
  // Ownership
  ownedKindle       Boolean     @default(false)
  ownedAudible      Boolean     @default(false)
  kindleAsin        String?
  audibleAsin       String?
  audibleDuration   String?
  audibleNarrators  String[]
  
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt
  
  @@unique([libraryId, bookId])
  @@index([shelf])
  @@index([myRating])
  @@index([dateRead])
  @@index([dateAdded])
}

// ============================================
// SERIES
// ============================================

model Series {
  id                String      @id @default(cuid())
  name              String
  slug              String      @unique
  description       String?     @db.Text
  openLibraryKey    String?
  
  // Relations
  books             Book[]
  
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt
}

// ============================================
// AUTHORS
// ============================================

model Author {
  id                String      @id @default(cuid())
  name              String
  slug              String      @unique
  openLibraryKey    String?
  bio               String?     @db.Text
  photoUrl          String?
  birthDate         String?
  deathDate         String?
  
  books             BookAuthor[]
  
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt
}

model BookAuthor {
  book              Book        @relation(fields: [bookId], references: [id], onDelete: Cascade)
  bookId            String
  author            Author      @relation(fields: [authorId], references: [id], onDelete: Cascade)
  authorId          String
  role              String      @default("author") // author, narrator, editor
  
  @@id([bookId, authorId, role])
}

// ============================================
// ENUMS
// ============================================

enum Shelf {
  READ
  CURRENTLY_READING
  TO_READ
  TO_READ_SOONER
  DID_NOT_FINISH
}
```

---

## Pages

### Public Pages

| Route | Description |
|-------|-------------|
| `/` | Home — Hero + stats + recent reads + featured shelves |
| `/books` | Book catalog — sortable, filterable grid/list of all books |
| `/books/[slug]` | Book detail — cover, description, author(s), series link, ownership badges, rating |
| `/authors` | Author index — alphabetical list with book counts |
| `/authors/[slug]` | Author detail — bio, photo, list of their books in library |
| `/series` | Series index — all series with book counts, completion status |
| `/series/[slug]` | Series detail — ordered list of books, reading progress |
| `/shelves` | Shelf overview — cards for each shelf with counts |
| `/shelves/[shelf]` | Shelf view — books filtered by shelf (read, to-read, etc.) |
| `/stats` | Reading stats — charts, yearly breakdown, genre distribution |

### Admin Pages (Protected)

| Route | Description |
|-------|-------------|
| `/admin` | Dashboard — quick stats, recent activity, import status |
| `/admin/books` | Book management — table with search, bulk actions |
| `/admin/books/new` | Add book — manual entry or ISBN lookup |
| `/admin/books/[id]/edit` | Edit book — full form with all fields |
| `/admin/authors` | Author management — table with edit/merge capabilities |
| `/admin/authors/[id]/edit` | Edit author — bio, photo, merge duplicates |
| `/admin/series` | Series management — table with book counts |
| `/admin/series/new` | Create series |
| `/admin/series/[id]/edit` | Edit series — reorder books, merge series |
| `/admin/import` | Data import — upload CSV, sync from sources |
| `/admin/settings` | Settings — API keys, preferences |

---

## API Endpoints

### Books

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/books` | List books (paginated, filterable) | Public |
| `GET` | `/api/books/[slug]` | Get single book | Public |
| `POST` | `/api/books` | Create book | Admin |
| `PATCH` | `/api/books/[id]` | Update book | Admin |
| `DELETE` | `/api/books/[id]` | Delete book | Admin |
| `POST` | `/api/books/lookup` | Lookup by ISBN via OpenLibrary | Admin |
| `POST` | `/api/books/[id]/enrich` | Fetch missing data from OpenLibrary | Admin |

### Authors

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/authors` | List authors (paginated) | Public |
| `GET` | `/api/authors/[slug]` | Get single author with books | Public |
| `POST` | `/api/authors` | Create author | Admin |
| `PATCH` | `/api/authors/[id]` | Update author | Admin |
| `DELETE` | `/api/authors/[id]` | Delete author | Admin |
| `POST` | `/api/authors/[id]/enrich` | Fetch bio from OpenLibrary | Admin |
| `POST` | `/api/authors/merge` | Merge duplicate authors | Admin |

### Series

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/series` | List all series (with book counts) | Public |
| `GET` | `/api/series/[slug]` | Get series with ordered books | Public |
| `POST` | `/api/series` | Create series | Admin |
| `PATCH` | `/api/series/[id]` | Update series | Admin |
| `DELETE` | `/api/series/[id]` | Delete series (unlinks books) | Admin |
| `POST` | `/api/series/merge` | Merge duplicate series | Admin |
| `PATCH` | `/api/series/[id]/reorder` | Reorder books in series | Admin |

### Shelves & Stats

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/shelves` | Get shelf counts | Public |
| `GET` | `/api/stats` | Get reading statistics | Public |
| `GET` | `/api/stats/yearly/[year]` | Get stats for specific year | Public |

### Import & Sync

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/api/import/goodreads` | Import Goodreads CSV | Admin |
| `POST` | `/api/import/kindle` | Import Kindle JSON | Admin |
| `POST` | `/api/import/audible` | Import Audible JSON | Admin |
| `POST` | `/api/sync/covers` | Batch fetch missing covers | Admin |

### Auth

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `GET/POST` | `/api/auth/[...nextauth]` | NextAuth handlers | — |

---

## UI & Design

### Design Status: ✅ Defined

Design guidelines established based on the **UPENLY** Figma template — a warm, literary aesthetic perfect for a personal book library.

**See:** [`DESIGN-GUIDELINES.md`](./DESIGN-GUIDELINES.md) for full specifications.

### Design Decisions

| Question | Decision |
|----------|----------|
| **Vibe** | Cozy-bookish — warm, literary, inviting |
| **Color palette** | Warm brown primary (`#8B5A2B`), cream backgrounds, dark charcoal footer |
| **Typography** | Mixed — Playfair Display (serif) headings, Inter (sans-serif) body |
| **Dark mode** | Future consideration (Phase 5) |
| **Component library** | Custom SCSS based on design guidelines |
| **Density** | Spacious — generous whitespace, breathing room |

### Inspiration

| Source | What we're taking from it |
|--------|--------------------------|
| **UPENLY Figma template** | Overall aesthetic, color palette, typography, card design, layout patterns |

*Reference images in `design-inspo/` folder.*

### Design System Summary

#### Colors

```scss
// Primary
$color-primary: #8B5A2B;        // Warm brown
$color-primary-hover: #6B4423;  // Deep brown

// Neutrals
$color-bg: #FEFEFE;             // Cream white
$color-surface: #F5F5F5;        // Off-white (cards, sections)
$color-border: #E5E5E5;         // Light gray
$color-text: #333333;           // Dark gray (body)
$color-text-heading: #1A1A1A;   // Charcoal (headings)
$color-text-muted: #666666;     // Medium gray

// Semantic
$color-success: #4A7C59;        // Read/completed
$color-warning: #D4A574;        // In progress / currently reading
$color-info: #6B8CAE;           // To read

// Ownership badges
$color-kindle: #FF9900;         // Amazon orange
$color-audible: #F7991C;        // Audible orange
```

#### Typography

```scss
// Font families
$font-heading: 'Playfair Display', 'Georgia', serif;
$font-body: 'Inter', 'Helvetica Neue', sans-serif;
$font-mono: 'JetBrains Mono', monospace;

// Scale
$font-size-xs: 0.75rem;    // 12px — tags, badges
$font-size-sm: 0.875rem;   // 14px — captions, small text
$font-size-base: 1rem;     // 16px — body
$font-size-lg: 1.25rem;    // 20px — subsections
$font-size-xl: 1.5rem;     // 24px — card titles
$font-size-2xl: 2.5rem;    // 40px — section headings
$font-size-3xl: 3.5rem;    // 56px — hero headlines
```

#### Spacing

```scss
$space-xs: 0.25rem;    // 4px
$space-sm: 0.5rem;     // 8px
$space-md: 1rem;       // 16px
$space-lg: 1.5rem;     // 24px
$space-xl: 2rem;       // 32px
$space-2xl: 3rem;      // 48px
$space-3xl: 4rem;      // 64px
$space-4xl: 6rem;      // 96px
```

#### Border Radius

```scss
$radius-sm: 4px;       // Buttons
$radius-md: 8px;       // Cards
$radius-lg: 12px;      // Modals
$radius-full: 9999px;  // Pills, badges
```

#### Shadows

```scss
$shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.06);    // Cards (default)
$shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);   // Cards (hover)
$shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.1);    // Modals, dropdowns
```

### Key UI Patterns

#### Book Card (Grid View)
```
┌─────────────────────┐
│ ┌─────────────────┐ │
│ │                 │ │
│ │   Cover Image   │ │
│ │                 │ │
│ │                 │ │
│ └─────────────────┘ │
│ Title of the Book   │
│ Author Name         │
│ ★★★★☆  📱 🎧        │
└─────────────────────┘
```

#### Book Card (List View)
```
┌──────────────────────────────────────────────────────┐
│ ┌──────┐  Title of the Book                    ★★★★☆ │
│ │Cover │  Author Name                                │
│ │      │  Series Name #3  •  352 pages  •  2024     │
│ └──────┘  📱 Kindle  🎧 Audible         [Read]       │
└──────────────────────────────────────────────────────┘
```

#### Book Detail Header
```
┌────────────────────────────────────────────────────────────┐
│  ┌────────────┐                                            │
│  │            │  Title of the Book                         │
│  │   Cover    │  by Author Name                            │
│  │   Image    │                                            │
│  │            │  ★★★★☆ My Rating  •  4.2 avg              │
│  │            │                                            │
│  │            │  📱 Kindle  🎧 Audible                     │
│  └────────────┘                                            │
│                                                            │
│  Part of: Series Name (#3 of 7)                           │
│                                                            │
│  [Read] [To Read] [Currently Reading] [DNF]               │
└────────────────────────────────────────────────────────────┘
```

#### Filter Bar
```
┌────────────────────────────────────────────────────────────┐
│ 🔍 Search...          Shelf ▼   Rating ▼   Owned ▼   ⊞ ☰  │
│                                                            │
│ Active: [Read ✕] [5 stars ✕] [Kindle ✕]      Sort: Date ▼ │
└────────────────────────────────────────────────────────────┘
```

#### Series Progress
```
┌────────────────────────────────────────────────────────────┐
│  The Zoey Ashe Series                      3 of 3 read ✓  │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 100%      │
│                                                            │
│  1. Futuristic Violence and Fancy Suits    ✓ Read         │
│  2. Zoey Punches the Future in the Dick    ✓ Read         │
│  3. Zoey Is Too Drunk for This Dystopia    ✓ Read         │
└────────────────────────────────────────────────────────────┘
```

### Responsive Design

**All layouts must be fully responsive across mobile, tablet, and desktop.**

#### Breakpoints

```scss
$breakpoint-sm: 640px;   // Mobile landscape
$breakpoint-md: 768px;   // Tablet
$breakpoint-lg: 1024px;  // Desktop
$breakpoint-xl: 1280px;  // Large desktop
```

#### Layout Behavior

| Component | Mobile (<640px) | Tablet (768px) | Desktop (1024px+) |
|-----------|----------------|----------------|-------------------|
| **Container** | 100% - 24px padding | 100% - 32px padding | 1200px max, centered |
| **Book Grid** | 1 column | 2 columns | 4 columns |
| **Navigation** | Hamburger menu | Hamburger menu | Full nav bar |
| **Book Card** | Full width | 2-up | 4-up grid |
| **Book Detail** | Stacked (cover → info) | Side-by-side | Side-by-side with more space |
| **Filter Panel** | Collapsible drawer | Collapsible drawer | Inline/sidebar |
| **Footer** | Stacked sections | 2 columns | 4 columns |

#### Mobile-First Approach

- Start with mobile styles, layer up with `min-width` media queries
- Touch targets minimum 44x44px
- Adequate tap spacing between interactive elements
- Swipe gestures for carousels (if used)
- Bottom sheet modals on mobile for filters

#### Tablet Considerations

- Two-column book grid balances density and readability
- Navigation can remain collapsed or expand depending on orientation
- Book detail page works well side-by-side at this width

### Accessibility Considerations

- [ ] Color contrast ratios (WCAG AA minimum)
- [ ] Focus states for keyboard navigation
- [ ] Alt text for cover images
- [ ] Screen reader friendly shelf/rating labels
- [ ] Reduced motion option

---

## Sort & Filter

### URL Query Parameters

Filters persist in URL for shareable/bookmarkable views:

```
/books?shelf=read&rating=5&sort=dateRead&order=desc&owned=kindle&series=zoey-ashe
```

| Param | Values | Default |
|-------|--------|---------|
| `shelf` | read, currently-reading, to-read, to-read-sooner, did-not-finish | all |
| `rating` | 1, 2, 3, 4, 5 | all |
| `owned` | kindle, audible, both, none | all |
| `series` | series slug | all |
| `author` | author slug | all |
| `year` | YYYY (year read) | all |
| `q` | search query | — |
| `sort` | title, author, dateRead, dateAdded, rating, pages | dateAdded |
| `order` | asc, desc | desc |
| `view` | grid, list | grid |
| `page` | number | 1 |
| `limit` | 12, 24, 48 | 24 |

### API Filter Support

All list endpoints support these query params:

```
GET /api/books?shelf=read&rating=5&sort=dateRead&order=desc&page=1&limit=24
```

---

## OpenLibrary Integration

### Endpoints Used

```
# Search by ISBN
https://openlibrary.org/isbn/{isbn}.json

# Search by title/author
https://openlibrary.org/search.json?title={title}&author={author}

# Get work details (description)
https://openlibrary.org/works/{work_id}.json

# Get author details
https://openlibrary.org/authors/{author_id}.json

# Cover images
https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg
https://covers.openlibrary.org/b/id/{cover_id}-L.jpg
```

### Data Enrichment Strategy

1. **On Import**: For each book, attempt ISBN lookup
2. **Background Job**: Queue books missing covers/descriptions
3. **On Demand**: "Enrich" button in admin to fetch missing data
4. **Cache**: Store OpenLibrary keys to avoid re-fetching

---

## UI Components

### Core Components

- `BookCard` — Cover, title, author, rating, ownership badges
- `BookGrid` — Responsive grid of BookCards
- `BookList` — Table/list view alternative
- `BookDetail` — Full book page layout
- `AuthorCard` — Photo, name, book count
- `AuthorDetail` — Full author page layout
- `SeriesCard` — Name, book count, completion progress
- `SeriesDetail` — Ordered book list with reading status
- `SeriesBadge` — "Book 3 of 7" indicator
- `ShelfBadge` — Read, To-Read, etc. pills
- `OwnershipBadge` — Kindle/Audible icons
- `RatingStars` — Display and input for 1-5 stars
- `FilterPanel` — Shelf, rating, ownership, year, series filters
- `SortSelect` — Sort by title, author, date read, rating, date added, pages
- `SearchBar` — Global book/author/series search with typeahead
- `ActiveFilters` — Pills showing current filters with remove buttons
- `Pagination` — Page navigation
- `ViewToggle` — Grid/list view switcher

### Admin Components

- `DataTable` — Sortable, searchable table
- `BookForm` — Create/edit book form
- `AuthorForm` — Create/edit author form
- `SeriesForm` — Create/edit series form
- `SeriesReorder` — Drag-and-drop book ordering
- `ImportWizard` — Step-by-step CSV/JSON import
- `BulkActions` — Multi-select actions
- `MergeModal` — Merge duplicate authors/series

---

## Features by Phase

### Phase 1: MVP
- [ ] Database setup (Vercel Postgres + Prisma)
- [ ] NextAuth setup (Google + GitHub, admin role)
- [ ] Data import scripts (Goodreads, Kindle, Audible)
- [ ] Match/merge books across sources by ISBN/title
- [ ] Basic book listing page with pagination
- [ ] Book detail page
- [ ] Author pages (basic)
- [ ] Series pages (basic — from Goodreads/Audible data)
- [ ] Shelf filtering

### Phase 2: Enrichment
- [ ] OpenLibrary integration for covers
- [ ] OpenLibrary integration for descriptions
- [ ] Author bio enrichment
- [ ] Background job for batch enrichment

### Phase 3: Admin CRUD
- [ ] Admin dashboard
- [ ] Add/edit/delete books
- [ ] Add/edit/delete authors
- [ ] Merge duplicate authors
- [ ] Manual cover upload

### Phase 4: Polish
- [ ] Reading stats page
- [ ] Search functionality (global, typeahead)
- [ ] Sort options (title, author, date read, rating, date added)
- [ ] Advanced filters (year, rating, pages, ownership, genre)
- [ ] Filter persistence (URL params)
- [ ] Responsive design refinement
- [ ] SEO optimization

### Phase 5: Nice-to-Have
- [ ] Reading challenge/goals
- [ ] Book recommendations
- [ ] Export functionality
- [ ] Public API
- [ ] Dark mode

---

## Environment Variables

```env
# Database
DATABASE_URL="postgresql://..."

# Auth
NEXTAUTH_SECRET="..."
NEXTAUTH_URL="https://your-domain.vercel.app"

# Admin (simple approach: single admin email)
ADMIN_EMAIL="cheryl@example.com"

# OpenLibrary (no key needed, but rate limit awareness)
OPENLIBRARY_RATE_LIMIT="100" # requests per minute
```

---

## File Structure

```
my-library/
├── prisma/
│   └── schema.prisma
├── src/
│   ├── app/
│   │   ├── (public)/
│   │   │   ├── page.tsx                 # Home
│   │   │   ├── books/
│   │   │   │   ├── page.tsx             # Book catalog
│   │   │   │   └── [slug]/page.tsx      # Book detail
│   │   │   ├── authors/
│   │   │   │   ├── page.tsx             # Author index
│   │   │   │   └── [slug]/page.tsx      # Author detail
│   │   │   ├── series/
│   │   │   │   ├── page.tsx             # Series index
│   │   │   │   └── [slug]/page.tsx      # Series detail
│   │   │   ├── shelves/
│   │   │   │   ├── page.tsx             # Shelf overview
│   │   │   │   └── [shelf]/page.tsx     # Shelf view
│   │   │   └── stats/page.tsx           # Reading stats
│   │   ├── admin/
│   │   │   ├── layout.tsx               # Admin layout + auth check
│   │   │   ├── page.tsx                 # Dashboard
│   │   │   ├── books/
│   │   │   │   ├── page.tsx             # Book management
│   │   │   │   ├── new/page.tsx         # Add book
│   │   │   │   └── [id]/edit/page.tsx   # Edit book
│   │   │   ├── authors/
│   │   │   │   ├── page.tsx             # Author management
│   │   │   │   └── [id]/edit/page.tsx   # Edit author
│   │   │   ├── series/
│   │   │   │   ├── page.tsx             # Series management
│   │   │   │   ├── new/page.tsx         # Create series
│   │   │   │   └── [id]/edit/page.tsx   # Edit series
│   │   │   ├── import/page.tsx          # Data import
│   │   │   └── settings/page.tsx        # Settings
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/route.ts
│   │   │   ├── books/
│   │   │   │   ├── route.ts             # GET list, POST create
│   │   │   │   ├── [slug]/route.ts      # GET single
│   │   │   │   ├── [id]/route.ts        # PATCH, DELETE
│   │   │   │   ├── lookup/route.ts      # POST ISBN lookup
│   │   │   │   └── [id]/enrich/route.ts # POST enrich
│   │   │   ├── authors/
│   │   │   │   ├── route.ts
│   │   │   │   ├── [slug]/route.ts
│   │   │   │   ├── [id]/route.ts
│   │   │   │   ├── [id]/enrich/route.ts
│   │   │   │   └── merge/route.ts
│   │   │   ├── series/
│   │   │   │   ├── route.ts
│   │   │   │   ├── [slug]/route.ts
│   │   │   │   ├── [id]/route.ts
│   │   │   │   ├── [id]/reorder/route.ts
│   │   │   │   └── merge/route.ts
│   │   │   ├── shelves/route.ts
│   │   │   ├── stats/route.ts
│   │   │   └── import/
│   │   │       ├── goodreads/route.ts
│   │   │       ├── kindle/route.ts
│   │   │       └── audible/route.ts
│   │   └── layout.tsx
│   ├── components/
│   │   ├── books/
│   │   │   ├── BookCard/
│   │   │   ├── BookGrid/
│   │   │   ├── BookDetail/
│   │   │   └── BookForm/
│   │   ├── authors/
│   │   │   ├── AuthorCard/
│   │   │   └── AuthorDetail/
│   │   ├── series/
│   │   │   ├── SeriesCard/
│   │   │   ├── SeriesDetail/
│   │   │   ├── SeriesBadge/
│   │   │   └── SeriesForm/
│   │   ├── filters/
│   │   │   ├── FilterPanel/
│   │   │   ├── SortSelect/
│   │   │   ├── SearchBar/
│   │   │   ├── ActiveFilters/
│   │   │   └── ViewToggle/
│   │   ├── ui/
│   │   │   ├── Badge/
│   │   │   ├── Button/
│   │   │   ├── Card/
│   │   │   ├── Input/
│   │   │   ├── Modal/
│   │   │   ├── Pagination/
│   │   │   └── DataTable/
│   │   └── layout/
│   │       ├── Header/
│   │       ├── Footer/
│   │       └── Sidebar/
│   ├── lib/
│   │   ├── prisma.ts                    # Prisma client
│   │   ├── auth.ts                      # NextAuth config
│   │   ├── openlibrary.ts               # OpenLibrary API client
│   │   └── utils.ts                     # Helpers
│   ├── hooks/
│   │   ├── useBooks.ts
│   │   ├── useAuthors.ts
│   │   └── useStats.ts
│   ├── types/
│   │   └── index.ts
│   └── styles/
│       ├── globals.scss
│       ├── variables.scss
│       └── mixins.scss
├── scripts/
│   ├── import-goodreads.ts
│   ├── import-kindle.ts
│   ├── import-audible.ts
│   └── enrich-covers.ts
├── public/
│   └── images/
├── .env.local
├── next.config.js
├── package.json
└── tsconfig.json
```

---

## Decisions

| Question | Decision |
|----------|----------|
| Auth provider | Google + GitHub (both) |
| Public vs Private | Public browsing, login required only for admin/edits |
| Series support | ✅ Yes — track series and reading order |
| Multiple users | Yes — design for multi-user from the start |
| Cover fallback | Generic placeholder with book title |

---

## Next Steps

1. ✅ Create PRD (this document)
2. [ ] Finalize open questions
3. [ ] Initialize Next.js project
4. [ ] Set up Vercel Postgres + Prisma
5. [ ] Write import scripts to populate initial data
6. [ ] Build MVP pages

---

*Let me know what to refine!*
