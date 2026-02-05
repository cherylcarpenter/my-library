import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import Badge from '@/components/Badge';
import RatingStars from '@/components/RatingStars';
import styles from './page.module.scss';

interface SeriesBook {
  id: string;
  slug: string;
  title: string;
  coverUrl?: string;
  position?: number;
  rating?: number;
  shelf?: string;
  authors: { id: string; name: string; slug: string }[];
}

interface SeriesDetail {
  id: string;
  name: string;
  slug: string;
  books: SeriesBook[];
  bookCount: number;
  booksRead: number;
  completionPercentage: number;
}

async function getSeriesDetail(slug: string): Promise<SeriesDetail | null> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/series/${slug}`,
    { cache: 'no-store' }
  );
  if (!res.ok) return null;
  return res.json();
}

export default async function SeriesDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const series = await getSeriesDetail(slug);

  if (!series) {
    notFound();
  }

  // Sort books by position
  const sortedBooks = [...series.books].sort((a, b) => 
    (a.position || 999) - (b.position || 999)
  );

  return (
    <div className={styles.seriesDetail}>
      <div className={styles.container}>
        <nav className={styles.breadcrumb}>
          <Link href="/series">← Back to Series</Link>
        </nav>
        <header className={styles.header}>
          <h1>{series.name}</h1>
          <p className={styles.subtitle}>
            {series.bookCount} {series.bookCount === 1 ? 'book' : 'books'} in series
          </p>
          
          <div className={styles.progress}>
            <div className={styles.progressBar}>
              <div 
                className={styles.progressFill}
                style={{ width: `${series.completionPercentage || 0}%` }}
              />
            </div>
            <span className={styles.progressText}>
              {series.booksRead || 0} of {series.bookCount} read ({Math.round(series.completionPercentage || 0)}%)
            </span>
          </div>
        </header>

        <section className={styles.books}>
          {sortedBooks.map((book) => (
            <Link
              key={book.id}
              href={`/books/${book.slug}`}
              className={styles.bookItem}
            >
              <div className={styles.position}>
                {book.position || '—'}
              </div>
              
              <div className={styles.cover}>
                {book.coverUrl ? (
                  <Image
                    src={book.coverUrl}
                    alt={book.title}
                    fill
                    sizes="60px"
                    className={styles.coverImage}
                  />
                ) : (
                  <div className={styles.placeholder}>📖</div>
                )}
              </div>

              <div className={styles.bookInfo}>
                <h3 className={styles.bookTitle}>{book.title}</h3>
                <p className={styles.authors}>
                  {book.authors.map(a => a.name).join(', ')}
                </p>
                {book.rating && (
                  <RatingStars rating={book.rating} size="sm" />
                )}
              </div>

              {book.shelf && (
                <div className={styles.shelfBadge}>
                  <Badge variant="shelf">{book.shelf}</Badge>
                </div>
              )}
            </Link>
          ))}
        </section>
      </div>
    </div>
  );
}
