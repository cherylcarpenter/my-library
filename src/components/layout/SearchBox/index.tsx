'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import styles from './styles.module.scss';

interface SearchBook {
  id: string;
  title: string;
  slug: string;
  coverUrl: string | null;
  yearPublished: number | null;
  authors: { id: string; name: string; slug: string }[];
}

interface SearchAuthor {
  id: string;
  name: string;
  slug: string;
  photoUrl: string | null;
  bookCount: number;
}

interface SearchResults {
  books: SearchBook[];
  authors: SearchAuthor[];
}

export default function SearchBox() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const router = useRouter();

  // All selectable items as a flat list for keyboard navigation
  const allItems: { type: 'book' | 'author' | 'viewAll'; href: string }[] = [];
  if (results) {
    results.books.forEach(b => allItems.push({ type: 'book', href: `/books/${b.slug}` }));
    results.authors.forEach(a => allItems.push({ type: 'author', href: `/authors/${a.slug}` }));
    if (results.books.length > 0 || results.authors.length > 0) {
      allItems.push({ type: 'viewAll', href: `/search?q=${encodeURIComponent(query)}` });
    }
  }

  const fetchResults = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults(null);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&limit=5`);
      if (res.ok) {
        const data: SearchResults = await res.json();
        setResults(data);
        setIsOpen(true);
        setActiveIndex(-1);
      }
    } catch {
      // Silently fail — user can retry
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchResults(value), 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
      return;
    }

    if (e.key === 'Enter') {
      if (activeIndex >= 0 && activeIndex < allItems.length) {
        e.preventDefault();
        router.push(allItems[activeIndex].href);
        closeSearch();
      } else if (query.length >= 2) {
        e.preventDefault();
        router.push(`/search?q=${encodeURIComponent(query)}`);
        closeSearch();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev < allItems.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev > 0 ? prev - 1 : allItems.length - 1));
    }
  };

  const closeSearch = () => {
    setIsOpen(false);
    setQuery('');
    setResults(null);
    setActiveIndex(-1);
    setMobileExpanded(false);
  };

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setMobileExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Focus input when mobile expanded
  useEffect(() => {
    if (mobileExpanded) {
      inputRef.current?.focus();
    }
  }, [mobileExpanded]);

  let currentItemIndex = 0;

  return (
    <div className={styles.searchBox} ref={containerRef}>
      {/* Mobile search toggle */}
      <button
        className={styles.mobileToggle}
        onClick={() => setMobileExpanded(true)}
        aria-label="Open search"
      >
        <SearchIcon />
      </button>

      {/* Search input */}
      <div className={`${styles.inputWrapper} ${mobileExpanded ? styles.mobileOpen : ''}`}>
        <SearchIcon />
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          placeholder="Search books & authors..."
          value={query}
          onChange={e => handleInputChange(e.target.value)}
          onFocus={() => { if (results) setIsOpen(true); }}
          onKeyDown={handleKeyDown}
          aria-label="Search books and authors"
          aria-expanded={isOpen}
          role="combobox"
          aria-autocomplete="list"
        />
        {query && (
          <button className={styles.clearButton} onClick={closeSearch} aria-label="Clear search">
            <CloseIcon />
          </button>
        )}
        {mobileExpanded && (
          <button
            className={styles.mobileCancelButton}
            onClick={closeSearch}
          >
            Cancel
          </button>
        )}
      </div>

      {/* Dropdown results */}
      {isOpen && (
        <div className={styles.dropdown} role="listbox">
          {isLoading && (
            <div className={styles.loadingState}>Searching...</div>
          )}

          {!isLoading && results && results.books.length === 0 && results.authors.length === 0 && (
            <div className={styles.emptyState}>No results found</div>
          )}

          {!isLoading && results && results.books.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Books</div>
              {results.books.map(book => {
                const itemIdx = currentItemIndex++;
                return (
                  <Link
                    key={book.id}
                    href={`/books/${book.slug}`}
                    className={`${styles.resultItem} ${activeIndex === itemIdx ? styles.active : ''}`}
                    onClick={closeSearch}
                    role="option"
                    aria-selected={activeIndex === itemIdx}
                  >
                    {book.coverUrl ? (
                      <img src={book.coverUrl} alt="" className={styles.bookCover} />
                    ) : (
                      <div className={styles.bookCoverPlaceholder} />
                    )}
                    <div className={styles.resultInfo}>
                      <span className={styles.resultTitle}>{book.title}</span>
                      {book.authors.length > 0 && (
                        <span className={styles.resultMeta}>
                          {book.authors.map(a => a.name).join(', ')}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {!isLoading && results && results.authors.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Authors</div>
              {results.authors.map(author => {
                const itemIdx = currentItemIndex++;
                return (
                  <Link
                    key={author.id}
                    href={`/authors/${author.slug}`}
                    className={`${styles.resultItem} ${activeIndex === itemIdx ? styles.active : ''}`}
                    onClick={closeSearch}
                    role="option"
                    aria-selected={activeIndex === itemIdx}
                  >
                    {author.photoUrl ? (
                      <img src={author.photoUrl} alt="" className={styles.authorPhoto} />
                    ) : (
                      <div className={styles.authorPhotoPlaceholder} />
                    )}
                    <div className={styles.resultInfo}>
                      <span className={styles.resultTitle}>{author.name}</span>
                      <span className={styles.resultMeta}>
                        {author.bookCount} {author.bookCount === 1 ? 'book' : 'books'}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {!isLoading && results && (results.books.length > 0 || results.authors.length > 0) && (
            <Link
              href={`/search?q=${encodeURIComponent(query)}`}
              className={`${styles.viewAllLink} ${activeIndex === allItems.length - 1 ? styles.active : ''}`}
              onClick={closeSearch}
              role="option"
              aria-selected={activeIndex === allItems.length - 1}
            >
              View all results
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg className={styles.searchIcon} viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
      <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  );
}
