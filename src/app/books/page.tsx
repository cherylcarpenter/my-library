import { Suspense } from 'react';
import { Metadata } from 'next';
import BookOpenIcon from '@/components/Icons/BookOpenIcon';
import BookCard, { Book as BookType } from '@/components/BookCard';
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
  category?: string;
  kindle?: string;
  audible?: string;
  rating?: string;
  perPage?: string;
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
  else params.set('sort', '-dateRead'); // Default to Recently Read
  if (searchParams.category) params.set('category', searchParams.category);
  if (searchParams.kindle) params.set('kindle', searchParams.kindle);
  if (searchParams.audible) params.set('audible', searchParams.audible);
  if (searchParams.rating) params.set('rating', searchParams.rating);
  
  // Handle perPage parameter with default of 24
  const perPage = searchParams.perPage || '24';
  params.set('limit', perPage);

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

  // Build filter description
  const filters: string[] = [];
  if (params.shelf && params.shelf !== 'read' && params.shelf !== 'all') {
    filters.push(params.shelf.replace(/-/g, ' '));
  }
  if (params.category) {
    filters.push(params.category.replace(/-/g, ' '));
  }
  if (params.kindle) {
    filters.push('Kindle');
  }
  if (params.audible) {
    filters.push('Audible');
  }
  if (params.rating) {
    const ratingLabel = params.rating.endsWith('+')
      ? `${params.rating.slice(0, -1)}+ stars`
      : `${params.rating} star${params.rating === '1' ? '' : 's'}`;
    filters.push(ratingLabel);
  }
  
  const filterDescription = filters.length > 0
    ? `${total} ${filters.join(' + ')} books`
    : `${total} books on selected shelf`;

  return (
    <div className={styles.booksPage}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1>Books</h1>
          <p>{filterDescription}</p>
        </header>

        <Suspense fallback={<div>Loading filters...</div>}>
          <FilterBar basePath="/books" shelves={shelves} showViewToggle />
        </Suspense>

        {data.books && data.books.length > 0 ? (
          <>
            {viewMode === 'list' ? (
              <div className={styles.listView}>
                {data.books.map((book: BookType) => (
                  <BookCard key={book.id} book={book} variant="list" />
                ))}
              </div>
            ) : (
              <BookGrid>
                {data.books.map((book: BookType) => (
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
            <BookOpenIcon size={64} />
            <p>No books found</p>
          </div>
        )}
      </div>
    </div>
  );
}
