import { Metadata } from 'next';
import Link from 'next/link';
import styles from './page.module.scss';

export const metadata: Metadata = {
  title: 'Shelves',
  description: 'Browse books by reading shelf.',
};

interface Shelf {
  id: string;
  name: string;
  slug: string;
  bookCount: number;
  description?: string;
}

async function getShelves() {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/shelves`,
    { cache: 'no-store' }
  );
  if (!res.ok) return { shelves: [] };
  return res.json();
}

const shelfIcons: Record<string, string> = {
  'currently-reading': '📖',
  'read': '✅',
  'to-read': '📋',
  'dnf': '🚫',
  'favorites': '⭐',
};

export default async function ShelvesPage() {
  const data = await getShelves();

  return (
    <div className={styles.shelvesPage}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1>Shelves</h1>
          <p>Organize your reading</p>
        </header>

        {data.shelves && data.shelves.length > 0 ? (
          <div className={styles.grid}>
            {data.shelves.map((shelf: Shelf) => (
              <Link
                key={shelf.id}
                href={`/books?shelf=${shelf.slug}`}
                className={styles.card}
              >
                <div className={styles.icon}>
                  {shelfIcons[shelf.slug] || '📚'}
                </div>
                <div className={styles.info}>
                  <h2 className={styles.name}>{shelf.name}</h2>
                  {shelf.description && (
                    <p className={styles.description}>{shelf.description}</p>
                  )}
                  <p className={styles.count}>
                    {shelf.bookCount} {shelf.bookCount === 1 ? 'book' : 'books'}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <span>📚</span>
            <p>No shelves found</p>
          </div>
        )}
      </div>
    </div>
  );
}
