import Link from 'next/link';
import Image from 'next/image';
import Badge from '../Badge';
import RatingStars from '../RatingStars';
import styles from './styles.module.scss';

export interface Book {
  id: string;
  slug: string;
  title: string;
  coverUrl?: string;
  authors?: { id: string; name: string; slug: string }[];
  series?: { id: string; name: string; slug: string; position?: number };
  rating?: number;
  shelf?: string;
  hasKindle?: boolean;
  hasAudible?: boolean;
  // Alternative nested format from some APIs
  userBook?: {
    shelf?: string;
    myRating?: number;
    ownedKindle?: boolean;
    ownedAudible?: boolean;
  };
}

interface BookCardProps {
  book: Book;
  variant?: 'grid' | 'list';
}

export default function BookCard({ book, variant = 'grid' }: BookCardProps) {
  // Normalize data - handle both flat and nested userBook formats
  const shelf = book.shelf || book.userBook?.shelf;
  const rating = book.rating || book.userBook?.myRating;
  const hasKindle = book.hasKindle ?? book.userBook?.ownedKindle;
  const hasAudible = book.hasAudible ?? book.userBook?.ownedAudible;

  return (
    <article className={`${styles.card} ${variant === 'list' ? styles.listCard : ''}`}>
      <Link href={`/books/${book.slug}`} className={styles.coverLink}>
        <div className={styles.cover}>
          {book.coverUrl ? (
            <Image
              src={book.coverUrl}
              alt={book.title}
              fill
              sizes="(max-width: 768px) 50vw, 25vw"
              className={styles.coverImage}
            />
          ) : (
            <div className={styles.placeholder}>
              <span>📖</span>
            </div>
          )}
        </div>
      </Link>

      <div className={styles.info}>
        <Link href={`/books/${book.slug}`} className={styles.title}>
          {book.title}
        </Link>

        {book.authors && book.authors.length > 0 && (
          <div className={styles.authors}>
            {book.authors.map((author, i) => (
              <span key={author.id}>
                <Link href={`/authors/${author.slug}`}>{author.name}</Link>
                {i < book.authors.length - 1 && ', '}
              </span>
            ))}
          </div>
        )}

        {book.series && (
          <Link href={`/series/${book.series.slug}`} className={styles.series}>
            {book.series.name}
            {book.series.position && ` #${book.series.position}`}
          </Link>
        )}

        {rating && (
          <div className={styles.rating}>
            <RatingStars rating={rating} size="sm" />
          </div>
        )}

        <div className={styles.badges}>
          {shelf && <Badge variant="shelf">{shelf}</Badge>}
          {hasKindle && <Badge variant="kindle">Kindle</Badge>}
          {hasAudible && <Badge variant="audible">Audible</Badge>}
        </div>
      </div>
    </article>
  );
}
