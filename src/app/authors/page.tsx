import { Suspense } from 'react';
import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import AuthorLetterFilter from '@/components/AuthorLetterFilter';
import Pagination from '@/components/Pagination';
import styles from './page.module.scss';

export const metadata: Metadata = {
  title: 'Authors',
  description: 'Browse all authors in the library.',
};

interface Author {
  id: string;
  name: string;
  lastName?: string | null;
  slug: string;
  photoUrl?: string | null;
  bookCount: number;
}

// Helper to format "First Last" → "Last, First"
function formatAuthorName(name: string, lastName?: string | null): string {
  if (!lastName) return name;
  // Extract first name(s) from full name
  const fullParts = name.trim().split(' ');
  const lastIndex = fullParts.findIndex(p => p.toLowerCase() === lastName.toLowerCase());
  const firstName = lastIndex > 0 ? fullParts.slice(0, lastIndex).join(' ') : name;
  return `${lastName}, ${firstName}`;
}

// Helper to get initial from last name
function getLastNameInitial(lastName?: string | null, name?: string): string {
  if (lastName) return lastName.charAt(0).toUpperCase();
  return name?.charAt(0).toUpperCase() || '?';
}

interface SearchParams {
  page?: string;
  perPage?: string;
  letter?: string;
}

async function getAuthors(searchParams: SearchParams) {
  const params = new URLSearchParams();
  if (searchParams.page) params.set('page', searchParams.page);
  if (searchParams.letter) params.set('letter', searchParams.letter);
  
  // Handle perPage parameter with default of 24
  const perPage = searchParams.perPage || '24';
  params.set('limit', perPage);

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/authors?${params.toString()}`,
    { cache: 'no-store' }
  );
  if (!res.ok) return { authors: [], totalPages: 1 };
  return res.json();
}

export default async function AuthorsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const data = await getAuthors(params);
  const currentPage = parseInt(params.page || '1', 10);
  const currentLetter = params.letter || '';

  // Build filter description
  const filters: string[] = [];
  if (currentLetter) {
    filters.push(`Starting with "${currentLetter}"`);
  }
  
  const filterDescription = filters.length > 0
    ? `${data.pagination?.total || 0} ${filters.join(' + ')} authors`
    : `${data.pagination?.total || 0} authors in your library`;

  return (
    <div className={styles.authorsPage}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1>Authors</h1>
          <p>{filterDescription}</p>
        </header>

        <AuthorLetterFilter className={styles.letterFilter} />

        {data.authors && data.authors.length > 0 ? (
          <>
            <div className={styles.grid}>
              {data.authors.map((author: Author) => (
                <Link
                  key={author.id}
                  href={`/authors/${author.slug}`}
                  className={styles.card}
                >
                  <div className={styles.avatarWrapper}>
                    {author.photoUrl ? (
                      <Image
                        src={author.photoUrl}
                        alt={author.name}
                        width={60}
                        height={60}
                        className={styles.photo}
                        unoptimized
                      />
                    ) : (
                      <div className={styles.avatar}>
                        {getLastNameInitial(author.lastName, author.name)}
                      </div>
                    )}
                  </div>
                  <div className={styles.info}>
                    <h2 className={styles.name}>{formatAuthorName(author.name, author.lastName)}</h2>
                    <p className={styles.bookCount}>
                      {author.bookCount} {author.bookCount === 1 ? 'book' : 'books'}
                    </p>
                  </div>
                </Link>
              ))}
            </div>

            <Suspense fallback={null}>
              <Pagination
                currentPage={currentPage}
                totalPages={data.pagination?.totalPages || 1}
                basePath="/authors"
              />
            </Suspense>
          </>
        ) : (
          <div className={styles.empty}>
            <span>✍️</span>
            <p>No authors found</p>
          </div>
        )}
      </div>
    </div>
  );
}
