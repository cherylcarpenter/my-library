import { Suspense } from 'react';
import { Metadata } from 'next';
import BookCard, { Book } from '@/components/BookCard';
import BookGrid from '@/components/BookGrid';
import FilterBar from '@/components/FilterBar';
import Pagination from '@/components/Pagination';
import styles from './page.module.scss';

export const metadata: Metadata = {
  title: 'Books',
  description: 'Browse all books in the library.',
};

interface SearchParams {
  page?: string;
  shelf?: string;
  sort?: string;
  view?: string;
}

async function getBooks(searchParams: SearchParams) {
  const params = new URLSearchParams();
  if (searchParams.page) params.set('page', searchParams.page);
  
  // Handle shelf parameter: default to 'read', skip if 'all'
  const shelf = searchParams.shelf || 'read';
  if (shelf !== 'all') {
    params.set('shelf', shelf);
  }
  
  if (searchParams.sort) params.set('sort', searchParams.sort);
  params.set('limit', '12');

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/books?${params.toString()}`,
    { cache: 'no-store' }
  );
  if (!res.ok) return { books: [], totalPages: 1, currentPage: 1 };
  return res.json();
}

async function getShelves() {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/shelves`,
    { cache: 'no-store' }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.shelves || [];
}

export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  
  const [data, shelves] = await Promise.all([
    getBooks(params),
    getShelves(),
  ]);

  const currentPage = parseInt(params.page || '1', 10);
  const totalPages = data.pagination?.totalPages || 1;
  const total = data.pagination?.total || 0;
  const viewMode = params.view || 'grid';

  return (
    <div className={styles.booksPage}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1>Books</h1>
          <p>{total} books on selected shelf</p>
        </header>

        <Suspense fallback={<div>Loading filters...</div>}>
          <FilterBar basePath="/books" shelves={shelves} showViewToggle />
        </Suspense>

        {data.books && data.books.length > 0 ? (
          <>
            {viewMode === 'list' ? (
              <div className={styles.listView}>
                {data.books.map((book: Book) => (
                  <BookCard key={book.id} book={book} variant="list" />
                ))}
              </div>
            ) : (
              <BookGrid>
                {data.books.map((book: Book) => (
                  <BookCard key={book.id} book={book} />
                ))}
              </BookGrid>
            )}

            <Suspense fallback={null}>
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                basePath="/books"
              />
            </Suspense>
          </>
        ) : (
          <div className={styles.empty}>
            <span>📚</span>
            <p>No books found</p>
          </div>
        )}
      </div>
    </div>
  );
}
