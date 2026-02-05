import { Metadata } from 'next';
import Link from 'next/link';
import styles from './page.module.scss';

export const metadata: Metadata = {
  title: 'Series',
  description: 'Browse all book series in the library.',
};

interface Series {
  id: string;
  name: string;
  slug: string;
  bookCount: number;
  booksRead: number;
  completionPercentage: number;
}

async function getSeries() {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/series`,
    { cache: 'no-store' }
  );
  if (!res.ok) return { series: [] };
  return res.json();
}

export default async function SeriesPage() {
  const data = await getSeries();

  return (
    <div className={styles.seriesPage}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1>Series</h1>
          <p>{data.series?.length || 0} series in your library</p>
        </header>

        {data.series && data.series.length > 0 ? (
          <div className={styles.grid}>
            {data.series.map((series: Series) => (
              <Link
                key={series.id}
                href={`/series/${series.slug}`}
                className={styles.card}
              >
                <h2 className={styles.name}>{series.name}</h2>
                <p className={styles.bookCount}>
                  {series.bookCount} {series.bookCount === 1 ? 'book' : 'books'}
                </p>
                
                <div className={styles.progressWrapper}>
                  <div className={styles.progressBar}>
                    <div 
                      className={styles.progressFill}
                      style={{ width: `${series.completionPercentage || 0}%` }}
                    />
                  </div>
                  <span className={styles.progressText}>
                    {series.booksRead || 0}/{series.bookCount} read ({Math.round(series.completionPercentage || 0)}%)
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <span>📚</span>
            <p>No series found</p>
          </div>
        )}
      </div>
    </div>
  );
}
