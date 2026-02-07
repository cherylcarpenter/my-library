import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Badge from '@/components/Badge';
import RatingStars from '@/components/RatingStars';
import GenreTag from '@/components/GenreTag';
import styles from './page.module.scss';

// Strip HTML tags from OpenLibrary descriptions
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

interface BookDetail {
  id: string;
  slug: string;
  title: string;
  coverUrl?: string;
  authors: { id: string; name: string; slug: string }[];
  series?: { id: string; name: string; slug: string; position?: number };
  genres?: { id: string; name: string; slug: string }[];
  rating?: number;
  review?: string;
  shelf?: string;
  hasKindle?: boolean;
  hasAudible?: boolean;
  pages?: number;
  publishedYear?: number;
  isbn?: string;
  dateRead?: string;
  description?: string;
  openLibraryId?: string;
}

async function getBook(slug: string): Promise<BookDetail | null> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/books/${slug}`,
    { cache: 'no-store' }
  );
  if (!res.ok) return null;
  return res.json();
}

export default async function BookDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const book = await getBook(slug);

  if (!book) {
    notFound();
  }

  return (
    <div className={styles.bookDetail}>
      <div className={styles.container}>
        <nav className={styles.breadcrumb}>
          <Link href="/books">← Back to Books</Link>
        </nav>
        <div className={styles.layout}>
          {/* Cover */}
          <div className={styles.coverSection}>
            <div className={styles.cover}>
              {book.coverUrl ? (
                <Image
                  src={book.coverUrl}
                  alt={book.title}
                  fill
                  sizes="300px"
                  className={styles.coverImage}
                  priority
                />
              ) : (
                <div className={styles.placeholder}>
                  <span>📖</span>
                </div>
              )}
            </div>

            {/* Ownership Badges */}
            <div className={styles.ownership}>
              {book.hasKindle && <Badge variant="kindle">Kindle</Badge>}
              {book.hasAudible && <Badge variant="audible">Audible</Badge>}
            </div>
          </div>

          {/* Info */}
          <div className={styles.infoSection}>
            <h1 className={styles.title}>{book.title}</h1>

            <div className={styles.authors}>
              by{' '}
              {book.authors.map((author, i) => (
                <span key={author.id}>
                  <Link href={`/authors/${author.slug}`}>{author.name}</Link>
                  {i < book.authors.length - 1 && ', '}
                </span>
              ))}
            </div>

            {book.series && (
              <Link href={`/series/${book.series.slug}`} className={styles.seriesBadge}>
                <Badge variant="series">
                  {book.series.name}
                  {book.series.position && ` #${book.series.position}`}
                </Badge>
              </Link>
            )}

            {/* Genres */}
            {book.genres && book.genres.length > 0 && (
              <div className={styles.genres}>
                {book.genres.map((genre) => (
                  <Link
                    key={genre.id}
                    href={`/books?genre=${genre.slug}`}
                    className={styles.genreTag}
                  >
                    {genre.name}
                  </Link>
                ))}
              </div>
            )}

            {book.shelf && (
              <div className={styles.shelf}>
                <Badge variant="shelf">
                  {book.shelf.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </Badge>
              </div>
            )}

            {book.rating && (
              <div className={styles.rating}>
                <RatingStars rating={book.rating} size="lg" showValue />
              </div>
            )}

            {/* Metadata */}
            <div className={styles.metadata}>
              {book.pages && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Pages</span>
                  <span className={styles.metaValue}>{book.pages}</span>
                </div>
              )}
              {book.publishedYear && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Published</span>
                  <span className={styles.metaValue}>{book.publishedYear}</span>
                </div>
              )}
              {book.isbn && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>ISBN</span>
                  <span className={styles.metaValue}>{book.isbn}</span>
                </div>
              )}
              {book.dateRead && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Date Read</span>
                  <span className={styles.metaValue}>
                    {new Date(book.dateRead).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              )}
            </div>

            {/* OpenLibrary Link */}
            {book.openLibraryId && (
              <div className={styles.openLibrary}>
                <a
                  href={`https://openlibrary.org/works/${book.openLibraryId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.openLibraryLink}
                >
                  View on OpenLibrary →
                </a>
              </div>
            )}

            {/* Description */}
            {book.description && (
              <div className={styles.description}>
                <h2>Description</h2>
                <p style={{ whiteSpace: 'pre-wrap' }}>{stripHtml(book.description)}</p>
              </div>
            )}

            {/* Review */}
            {book.review && (
              <div className={styles.review}>
                <h2>My Review</h2>
                <p>{book.review}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
