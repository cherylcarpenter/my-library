# PRD: Homepage Quote Slider Enhancement

**Date:** 2026-02-07
**Status:** Draft
**Author:** Jeeves (for Cheryl)

---

## Overview

Replace the static hero section on the homepage with an elegant, auto-advancing quote slider featuring famous quotes about reading, books, and literacy.

## Goals

- Create an engaging, personalized entrance to the library experience
- Inspire users through meaningful literary quotes
- Establish a distinctive visual identity for the library

## Non-Goals

- Adding user-interactive features (voting, sharing)
- Dynamic content from external sources
- Multi-language support

## Background

The current hero section contains static copy that doesn't reflect the user's personal reading journey. A curated quote slider adds warmth and personality while maintaining the library's elegant aesthetic.

---

## User Stories

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| 1 | Visitor | see an inspiring quote on arrival | I feel welcomed and intrigued |
| 2 | Reader | the slider auto-advances | I can see multiple quotes without interaction |
| 3 | User | hover to pause the slider | I can read a longer quote at my own pace |
| 4 | User | see the quote author | I know who said it and can explore their work |

---

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Slider displays 10 curated quotes about reading/books/literacy | Must |
| FR-2 | Auto-advance every 6 seconds | Must |
| FR-3 | Pause animation on hover | Must |
| FR-4 | Subtle dot navigation at bottom center | Should |
| FR-5 | Smooth fade transition (500ms) | Should |
| FR-6 | Click dots to jump to specific quote | Could |
| FR-7 | Responsive design (mobile: smaller text) | Must |

### Non-Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-1 | No external carousel dependencies | Must |
| NFR-2 | Load time < 100ms additional | Should |
| NFR-3 | Accessible (keyboard navigation, screen reader support) | Should |
| NFR-4 | Works without JavaScript (show first quote) | Could |

---

## Quote List

| # | Quote | Author |
|---|-------|--------|
| 1 | "A room without books is like a body without a soul." | Cicero |
| 2 | "There is no friend as loyal as a book." | Ernest Hemingway |
| 3 | "Books are a uniquely portable magic." | Stephen King |
| 4 | "I have always imagined that paradise will be a kind of library." | Jorge Luis Borges |
| 5 | "A book is a dream that you hold in your hand." | Neil Gaiman |
| 6 | "Reading is to the mind what exercise is to the body." | Joseph Addison |
| 7 | "Books are the quietest and most constant of friends." | Charles William Eliot |
| 8 | "The only thing you absolutely have to know is the location of the library." | Albert Einstein |
| 9 | "A great book should leave you with many experiences." | William Styron |
| 10 | "Reading gives us someplace to go when we have to stay where we are." | Mason Cooley |

---

## Design Specifications

### Layout

```
┌─────────────────────────────────────────────┐
│                                             │
│         "Quote text here in large            │
│          elegant serif font"                 │
│                                             │
│                — Author Name                │
│                                             │
│              • • • ○ ○                      │
│                                             │
└─────────────────────────────────────────────┘
```

### Typography

| Element | Font | Size | Weight | Color |
|---------|------|------|--------|-------|
| Quote | Playfair Display | 2rem (desktop), 1.5rem (mobile) | 400 | #4A3728 (dark brown) |
| Author | Playfair Display | 1rem | 400 italic | #8B7355 (muted brown) |

### Colors

| Element | Color |
|---------|-------|
| Background | Cream: #FAF8F5 |
| Text | Dark Brown: #4A3728 |
| Author Text | Muted Brown: #8B7355 |
| Dot (active) | #8B5A2B |
| Dot (inactive) | #D4C4B0 |

### Spacing

- Quote text: 2rem margin bottom
- Author: 1rem below quote
- Dots: 1.5rem below author

### Transitions

- Fade in/out: 500ms ease-in-out
- Auto-advance interval: 6000ms

---

## Technical Approach

### Component Structure

```
src/
├── components/
│   └── QuoteSlider/
│       ├── index.tsx       # Main component
│       ├── quotes.ts        # Quote data (array of objects)
│       ├── styles.module.scss
│       └── useQuoteSlider.ts # Hook for carousel logic
└── app/
    └── page.tsx            # Import and use <QuoteSlider />
```

### Data Structure

```typescript
interface Quote {
  id: number;
  text: string;
  author: string;
}

const quotes: Quote[] = [
  { id: 1, text: "...", author: "Cicero" },
  // ... all 10 quotes
];
```

### Carousel Logic (Custom Hook)

```typescript
function useQuoteSlider(quotes: Quote[], interval: number = 6000) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  
  useEffect(() => {
    if (isPaused) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % quotes.length);
    }, interval);
    return () => clearInterval(timer);
  }, [isPaused, interval, quotes.length]);
  
  return { currentIndex, setCurrentIndex, isPaused, setIsPaused };
}
```

### Accessibility

- `role="marquee"` or `region` with `aria-label="Quote carousel"`
- Keyboard navigation for dots
- `aria-live="polite"` for screen readers
- Focus indicators on interactive elements

---

## Implementation Plan

### Phase 1: Component Development
- [ ] Create QuoteSlider component structure
- [ ] Add quote data file
- [ ] Implement carousel logic with useQuoteSlider hook
- [ ] Add styling (Playfair Display font)

### Phase 2: Integration
- [ ] Replace hero section in page.tsx
- [ ] Remove old hero styles
- [ ] Update responsive styles

### Phase 3: Polish
- [ ] Add dot navigation
- [ ] Implement fade transitions
- [ ] Test accessibility
- [ ] Cross-browser testing

---

## Open Questions

| # | Question | Answer |
|---|----------|--------|
| 1 | Keep or remove "Browse Library" CTA button? | Replace with subtle "Start Exploring" or remove |
| 2 | Show quote number (e.g., "1 of 10")? | No - keeps it elegant |
| 3 | Add subtle animation to quote appearance? | Simple fade only - keep it refined |

---

## Future Enhancements (Out of Scope)

- User-submitted quotes
- Quote of the day feature
- Integration with Goodreads quotes API
- Social sharing of quotes
- Bookmarking favorite quotes

---

## References

- Font: [Playfair Display](https://fonts.google.com/specimen/Playfair+Display) (Google Fonts)
- Color palette: Library's existing brown theme (#8B5A2B)
- Similar inspiration: Literary magazines, bookshop aesthetics
