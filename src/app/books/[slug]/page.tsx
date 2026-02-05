import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Badge from '@/components/Badge';
import RatingStars from '@/components/RatingStars';
import styles from './page.module.scss';

interface BookDetail {
  id: string;
  slug: string;
  title: string;
  coverUrl?: string;
  authors: { id: string; name: string; slug: string }[];
  series?: { id: string; name: string; slug: string; position?: number };
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

            {book.shelf && (
              <div className={styles.shelf}>
                <Badge variant="shelf">{book.shelf}</Badge>
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

            {/* Description */}
            {book.description && (
              <div className={styles.description}>
                <h2>Description</h2>
                <p>{book.description}</p>
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
