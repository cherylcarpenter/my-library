'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import styles from './styles.module.scss';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  basePath: string;
}

const perPageOptions = [
  { value: '12', label: '12 per page' },
  { value: '24', label: '24 per page' },
  { value: '48', label: '48 per page' },
  { value: '96', label: '96 per page' },
];

export default function Pagination({ currentPage, totalPages, basePath }: PaginationProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentPerPage = searchParams.get('perPage') || '24';

  if (totalPages <= 1) return null;

  const goToPage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', page.toString());
    router.push(`${basePath}?${params.toString()}`);
  };

  const updatePerPage = (perPage: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('perPage', perPage);
    params.delete('page'); // Reset to page 1 when changing results per page
    router.push(`${basePath}?${params.toString()}`);
  };

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const showPages = 5;
    
    if (totalPages <= showPages) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      
      if (currentPage > 3) pages.push('...');
      
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      
      for (let i = start; i <= end; i++) pages.push(i);
      
      if (currentPage < totalPages - 2) pages.push('...');
      
      pages.push(totalPages);
    }
    
    return pages;
  };

  return (
    <nav className={styles.pagination}>
      <select
        className={styles.perPageSelect}
        value={currentPerPage}
        onChange={(e) => updatePerPage(e.target.value)}
        aria-label="Results per page"
      >
        {perPageOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <button
        className={styles.arrow}
        onClick={() => goToPage(currentPage - 1)}
        disabled={currentPage === 1}
        aria-label="Previous page"
      >
        ←
      </button>

      <div className={styles.pages}>
        {getPageNumbers().map((page, i) => (
          typeof page === 'number' ? (
            <button
              key={i}
              className={`${styles.page} ${page === currentPage ? styles.active : ''}`}
              onClick={() => goToPage(page)}
            >
              {page}
            </button>
          ) : (
            <span key={i} className={styles.ellipsis}>{page}</span>
          )
        ))}
      </div>

      <button
        className={styles.arrow}
        onClick={() => goToPage(currentPage + 1)}
        disabled={currentPage === totalPages}
        aria-label="Next page"
      >
        →
      </button>
    </nav>
  );
}
