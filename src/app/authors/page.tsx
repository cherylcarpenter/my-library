import { Suspense } from 'react';
import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import Pagination from '@/components/Pagination';
import styles from './page.module.scss';

export const metadata: Metadata = {
  title: 'Authors',
  description: 'Browse all authors in the library.',
};

interface Author {
  id: string;
  name: string;
  slug: string;
  photoUrl?: string | null;
  bookCount: number;
}

interface SearchParams {
  page?: string;
}

async function getAuthors(searchParams: SearchParams) {
  const params = new URLSearchParams();
  if (searchParams.page) params.set('page', searchParams.page);
  params.set('limit', '12');

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

  return (
    <div className={styles.authorsPage}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1>Authors</h1>
          <p>{data.pagination?.total || 0} authors in your library</p>
        </header>

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
                        {author.name.charAt(0)}
                      </div>
                    )}
                  </div>
                  <div className={styles.info}>
                    <h2 className={styles.name}>{author.name}</h2>
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
