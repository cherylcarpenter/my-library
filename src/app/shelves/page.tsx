import { Metadata } from 'next';
import Link from 'next/link';
import BookOpenIcon from '@/components/Icons/BookOpenIcon';
import styles from './page.module.scss';

function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15l-5-5 1.4-1.4 3.6 3.6 7.6-7.6L19 9l-9 9z"/>
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
      <path d="M8 4h13v2H8V4zM4.5 6.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0 6.9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM8 11h13v2H8v-2zm0 7h13v2H8v-2z"/>
    </svg>
  );
}

function XCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7-.8 1.3z"/>
    </svg>
  );
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
    </svg>
  );
}

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

const shelfIcons: Record<string, React.ReactNode> = {
  'currently-reading': <BookOpenIcon size={28} />,
  'read': <CheckCircleIcon />,
  'to-read': <ListIcon />,
  'dnf': <XCircleIcon />,
  'favorites': <StarIcon />,
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
            <BookOpenIcon size={64} />
            <p>No shelves found</p>
          </div>
        )}
      </div>
    </div>
  );
}
