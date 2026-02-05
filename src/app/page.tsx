import Link from 'next/link';
import BookCard, { Book } from '@/components/BookCard';
import BookGrid from '@/components/BookGrid';
import styles from './page.module.scss';

async function getStats() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/stats`, {
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return res.json();
}

async function getCurrentlyReading() {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/books?shelf=currently-reading&limit=4`,
    { cache: 'no-store' }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.books || [];
}

async function getRecentlyRead() {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/books?shelf=read&sort=-dateRead&limit=6`,
    { cache: 'no-store' }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.books || [];
}

export default async function HomePage() {
  const [stats, currentlyReading, recentlyRead] = await Promise.all([
    getStats(),
    getCurrentlyReading(),
    getRecentlyRead(),
  ]);

  return (
    <div className={styles.home}>
      {/* Hero Section */}
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <h1>Your Personal Library</h1>
          <p>Track what you read, discover new books, and keep your reading journey organized.</p>
          <Link href="/books" className={styles.ctaButton}>
            Browse Library
          </Link>
        </div>
      </section>

      {/* Stats Section */}
      {stats && (
        <section className={styles.stats}>
          <div className={styles.container}>
            <div className={styles.statsGrid}>
              <div className={styles.statCard}>
                <span className={styles.statNumber}>{stats.overview?.totalBooks || 0}</span>
                <span className={styles.statLabel}>Total Books</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statNumber}>{stats.overview?.booksRead || 0}</span>
                <span className={styles.statLabel}>Books Read</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statNumber}>{stats.byShelf?.CURRENTLY_READING || 0}</span>
                <span className={styles.statLabel}>Currently Reading</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statNumber}>{stats.overview?.authorCount || 0}</span>
                <span className={styles.statLabel}>Authors</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Currently Reading Section */}
      {currentlyReading.length > 0 && (
        <section className={styles.section}>
          <div className={styles.container}>
            <div className={styles.sectionHeader}>
              <h2>Currently Reading</h2>
              <Link href="/books?shelf=currently-reading">View all →</Link>
            </div>
            <BookGrid>
              {currentlyReading.map((book: Book) => (
                <BookCard key={book.id} book={book} />
              ))}
            </BookGrid>
          </div>
        </section>
      )}

      {/* Recently Read Section */}
      {recentlyRead.length > 0 && (
        <section className={styles.section}>
          <div className={styles.container}>
            <div className={styles.sectionHeader}>
              <h2>Recently Read</h2>
              <Link href="/books?shelf=read">View all →</Link>
            </div>
            <BookGrid>
              {recentlyRead.map((book: Book) => (
                <BookCard key={book.id} book={book} />
              ))}
            </BookGrid>
          </div>
        </section>
      )}
    </div>
  );
}
