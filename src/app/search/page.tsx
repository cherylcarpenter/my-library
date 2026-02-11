import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import BookCard, { Book as BookType } from '@/components/BookCard';
import BookGrid from '@/components/BookGrid';
import styles from './page.module.scss';

export const metadata: Metadata = {
  title: 'Search',
  description: 'Search books and authors in the library.',
};

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

async function getSearchResults(query: string): Promise<SearchResults> {
  if (!query || query.length < 2) return { books: [], authors: [] };

  const params = new URLSearchParams({ q: query, limit: '20' });
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/search?${params.toString()}`,
    { cache: 'no-store' }
  );
  if (!res.ok) return { books: [], authors: [] };
  return res.json();
}

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function SearchPage({ searchParams }: PageProps) {
  const { q: query = '' } = await searchParams;
  const results = await getSearchResults(query);
  const hasResults = results.books.length > 0 || results.authors.length > 0;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>
          {query ? `Search results for "${query}"` : 'Search'}
        </h1>
        {query && hasResults && (
          <p className={styles.summary}>
            Found {results.books.length} {results.books.length === 1 ? 'book' : 'books'} and{' '}
            {results.authors.length} {results.authors.length === 1 ? 'author' : 'authors'}
          </p>
        )}
      </div>

      {!query && (
        <p className={styles.emptyMessage}>Enter a search term to find books and authors.</p>
      )}

      {query && !hasResults && (
        <p className={styles.emptyMessage}>
          No results found for &ldquo;{query}&rdquo;. Try a different search term.
        </p>
      )}

      {results.books.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Books</h2>
          <BookGrid>
            {results.books.map(book => (
              <BookCard
                key={book.id}
                book={{
                  id: book.id,
                  title: book.title,
                  slug: book.slug,
                  coverUrl: book.coverUrl || undefined,
                  authors: book.authors,
                }}
              />
            ))}
          </BookGrid>
        </section>
      )}

      {results.authors.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Authors</h2>
          <div className={styles.authorGrid}>
            {results.authors.map(author => (
              <Link
                key={author.id}
                href={`/authors/${author.slug}`}
                className={styles.authorCard}
              >
                <div className={styles.authorPhotoWrapper}>
                  {author.photoUrl ? (
                    <img
                      src={author.photoUrl}
                      alt={author.name}
                      className={styles.authorPhoto}
                    />
                  ) : (
                    <div className={styles.authorPhotoPlaceholder}>
                      {author.name.charAt(0)}
                    </div>
                  )}
                </div>
                <div className={styles.authorInfo}>
                  <span className={styles.authorName}>{author.name}</span>
                  <span className={styles.authorMeta}>
                    {author.bookCount} {author.bookCount === 1 ? 'book' : 'books'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
