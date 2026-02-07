import Link from 'next/link';
import Image from 'next/image';
import BookPlaceholderIcon from '@/components/Icons/BookPlaceholderIcon';
import Badge from '../Badge';
import RatingStars from '../RatingStars';
import GenreTag from '../GenreTag';
import styles from './styles.module.scss';

export interface Book {
  id: string;
  slug: string;
  title: string;
  coverUrl?: string;
  authors?: { id: string; name: string; slug: string }[];
  series?: { id: string; name: string; slug: string; position?: number };
  genres?: { id: string; name: string; slug: string }[];
  rating?: number;
  shelf?: string;
  dateRead?: string | null;
  hasKindle?: boolean;
  hasAudible?: boolean;
  // Alternative nested format from some APIs
  userBook?: {
    shelf?: string;
    myRating?: number;
    dateRead?: string | null;
    ownedKindle?: boolean;
    ownedAudible?: boolean;
  };
}

interface BookCardProps {
  book: Book;
  variant?: 'grid' | 'list';
  onGenreClick?: (slug: string) => void;
}

export default function BookCard({ book, variant = 'grid', onGenreClick }: BookCardProps) {
  // Normalize data - handle both flat and nested userBook formats
  const shelf = book.shelf || book.userBook?.shelf;
  const rating = book.rating || book.userBook?.myRating;
  const dateRead = book.dateRead || book.userBook?.dateRead;
  const hasKindle = book.hasKindle ?? book.userBook?.ownedKindle;
  const hasAudible = book.hasAudible ?? book.userBook?.ownedAudible;

  // Format shelf name: "READ" → "Read", "TO_READ" → "To Read"
  const formatShelf = (s: string) => 
    s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  
  // Get shelf link: "READ" → /books?shelf=read
  const getShelfLink = (s: string) => `/books?shelf=${s.toLowerCase().replace(/_/g, '-')}`;

  // Get top 2-3 genres
  const topGenres = book.genres?.slice(0, 3) || [];

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
              <BookPlaceholderIcon />
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
                {i < (book.authors || []).length - 1 && ', '}
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

        {topGenres.length > 0 && (
          <div className={styles.genres}>
            {topGenres.map((genre) => (
              <GenreTag
                key={genre.id}
                name={genre.name}
                slug={genre.slug}
                onClick={onGenreClick}
              />
            ))}
          </div>
        )}

        {rating && (
          <div className={styles.rating}>
            <RatingStars rating={rating} size="sm" />
          </div>
        )}

        <div className={styles.badges}>
          {shelf && (
            <Badge variant="shelf" href={getShelfLink(shelf)}>
              {formatShelf(shelf)}
            </Badge>
          )}
          {hasKindle && <Badge variant="kindle" href="/books?kindle=true">Kindle</Badge>}
          {hasAudible && <Badge variant="audible" href="/books?audible=true">Audible</Badge>}
        </div>

        {shelf === 'READ' && dateRead && (
          <div className={styles.dateRead}>
            Read {new Date(dateRead).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
          </div>
        )}
      </div>
    </article>
  );
}
