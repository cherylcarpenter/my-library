# Design Document: Homepage Quote Slider

**Date:** 2026-02-07
**Related PRD:** quote-slider-prd.md
**Status:** Ready for Implementation

---

## Visual Design

### Desktop View (Full Width)

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   │
│   ▓                                                                 ▓
│   ▓                     "A room without books is like               ▓
│   ▓                        a body without a soul."                  ▓
│   ▓                                                                 ▓
│   ▓                              — Cicero                           ▓
│   ▓                                                                 ▓
│   ▓                           • • • • ○                            ▓
│   ▓                                                                 ▓
│   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   │
└─────────────────────────────────────────────────────────────────────┘
```

### Mobile View (375px width)

```
┌─────────────────────────────────┐
│                                 │
│   "A room without books is      │
│    like a body without a        │
│    soul."                       │
│                                 │
│         — Cicero               │
│                                 │
│         • • • • ○              │
│                                 │
└─────────────────────────────────┘
```

---

## CSS Variables (to add to global styles)

```scss
:root {
  // Quote Slider
  --quote-slider-bg: #FAF8F5;
  --quote-slider-text: #4A3728;
  --quote-slider-author: #8B7355;
  --quote-slider-dot-active: #8B5A2B;
  --quote-slider-dot-inactive: #D4C4B0;
  
  // Typography
  --font-quote: 'Playfair Display', Georgia, serif;
}
```

---

## Component Markup (Conceptual)

```tsx
<section className={styles.quoteSlider}>
  <div className={styles.quoteContainer}>
    <blockquote className={styles.quote}>
      <p>"{quotes[currentIndex].text}"</p>
      <cite>— {quotes[currentIndex].author}</cite>
    </blockquote>
  </div>
  
  <div className={styles.dots} role="tablist" aria-label="Quote navigation">
    {quotes.map((_, index) => (
      <button
        key={index}
        className={`${styles.dot} ${index === currentIndex ? styles.active : ''}`}
        onClick={() => goToQuote(index)}
        role="tab"
        aria-selected={index === currentIndex}
        aria-label={`Quote ${index + 1}`}
      />
    ))}
  </div>
</section>
```

---

## Styles (SCSS Module)

```scss
.quoteSlider {
  background: var(--quote-slider-bg);
  padding: 4rem 2rem;
  min-height: 300px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.quoteContainer {
  max-width: 800px;
  width: 100%;
}

.quote {
  margin: 0;
  
  p {
    font-family: var(--font-quote);
    font-size: 2rem;
    font-weight: 400;
    line-height: 1.4;
    color: var(--quote-slider-text);
    margin-bottom: 1.5rem;
    font-style: italic;
  }
  
  cite {
    display: block;
    font-family: var(--font-quote);
    font-size: 1rem;
    font-style: italic;
    color: var(--quote-slider-author);
    
    &::before {
      content: '— ';
    }
  }
}

.dots {
  display: flex;
  gap: 0.5rem;
  margin-top: 2rem;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--quote-slider-dot-inactive);
  border: none;
  cursor: pointer;
  transition: background 0.3s ease;
  padding: 0;
  
  &:hover {
    background: var(--quote-slider-dot-active);
  }
  
  &.active {
    background: var(--quote-slider-dot-active);
    transform: scale(1.2);
  }
}

// Animation
.quoteContainer {
  opacity: 1;
  transition: opacity 0.5s ease-in-out;
  
  &.fading {
    opacity: 0;
  }
}

// Responsive
@media (max-width: 768px) {
  .quoteSlider {
    padding: 3rem 1.5rem;
    min-height: 250px;
  }
  
  .quote p {
    font-size: 1.5rem;
  }
}

@media (max-width: 480px) {
  .quote p {
    font-size: 1.25rem;
  }
  
  .dots {
    gap: 0.375rem;
  }
  
  .dot {
    width: 8px;
    height: 8px;
  }
}
```

---

## Font Integration

### Option 1: Google Fonts (Recommended)

Add to `layout.tsx` or `globals.css`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
```

### Option 2: System Font Fallback

```scss
font-family: 'Playfair Display', 'Georgia', 'Times New Roman', serif;
```

---

## Animation Timing

| Event | Duration | Easing |
|-------|----------|--------|
| Fade out | 500ms | ease-in |
| Fade in | 500ms | ease-out |
| Auto-advance | 6000ms | linear (wait) |
| Dot hover | 200ms | ease |

---

## Accessibility Checklist

- [ ] Semantic `<blockquote>` for quotes
- [ ] `<cite>` for author attribution
- [ ] `role="tablist"` for dots
- [ ] `role="tab"` for each dot button
- [ ] `aria-selected` on active dot
- [ ] `aria-label` on each dot ("Quote 1 of 10")
- [ ] Keyboard navigation (arrow keys)
- [ ] `prefers-reduced-motion` support
- [ ] Focus indicators (visible outline)

---

## Browser Support

- Chrome 90+
- Safari 14+
- Firefox 88+
- Edge 90+

---

## Testing Checklist

- [ ] Quotes cycle automatically
- [ ] Hover pauses animation
- [ ] Clicking dots navigates correctly
- [ ] Responsive on mobile (375px)
- [ ] Responsive on tablet (768px)
- [ ] Font loads correctly
- [ ] Animation is smooth (no flicker)
- [ ] Screen reader announces quote changes
- [ ] Keyboard navigation works
