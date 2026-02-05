'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import styles from './styles.module.scss';

interface Shelf {
  id: string;
  name?: string;
  label?: string;
  slug?: string;
}

interface FilterBarProps {
  basePath: string;
  shelves?: Shelf[];
  showSort?: boolean;
  showViewToggle?: boolean;
}

const sortOptions = [
  { value: 'title', label: 'Title A-Z' },
  { value: '-title', label: 'Title Z-A' },
  { value: '-dateRead', label: 'Recently Read' },
  { value: '-rating', label: 'Highest Rated' },
  { value: '-createdAt', label: 'Recently Added' },
];

export default function FilterBar({ basePath, shelves = [], showSort = true, showViewToggle = false }: FilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const currentShelf = searchParams.get('shelf') || '';
  const currentSort = searchParams.get('sort') || '-createdAt';
  const currentView = searchParams.get('view') || 'grid';

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete('page'); // Reset to page 1 on filter change
    router.push(`${basePath}?${params.toString()}`);
  };

  return (
    <div className={styles.filterBar}>
      <div className={styles.filters}>
        <select
          className={styles.select}
          value={currentShelf}
          onChange={(e) => updateFilter('shelf', e.target.value)}
        >
          <option value="">All Shelves</option>
          {shelves.map((shelf) => (
            <option key={shelf.id} value={shelf.slug || shelf.id}>
              {shelf.name || shelf.label}
            </option>
          ))}
        </select>

        {showSort && (
          <select
            className={styles.select}
            value={currentSort}
            onChange={(e) => updateFilter('sort', e.target.value)}
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {showViewToggle && (
        <div className={styles.viewToggle}>
          <button
            className={`${styles.viewBtn} ${currentView === 'grid' ? styles.active : ''}`}
            onClick={() => updateFilter('view', 'grid')}
            aria-label="Grid view"
            title="Grid view"
          >
            ▦
          </button>
          <button
            className={`${styles.viewBtn} ${currentView === 'list' ? styles.active : ''}`}
            onClick={() => updateFilter('view', 'list')}
            aria-label="List view"
            title="List view"
          >
            ☰
          </button>
        </div>
      )}
    </div>
  );
}
