'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import CategoryFilter from '@/components/CategoryFilter';
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
  { value: '-createdAt', label: 'Recently Added' },
];

const formatOptions = [
  { value: '', label: 'All Formats' },
  { value: 'kindle', label: 'Kindle' },
  { value: 'audible', label: 'Audible' },
];

const ratingOptions = [
  { value: '', label: 'All Ratings' },
  { value: '5', label: '5 Stars' },
  { value: '4+', label: '4 & Up' },
  { value: '4', label: '4 Stars' },
  { value: '3+', label: '3 & Up' },
  { value: '3', label: '3 Stars' },
  { value: '2+', label: '2 & Up' },
  { value: '2', label: '2 Stars' },
  { value: '1+', label: '1 & Up' },
  { value: '1', label: '1 Star' },
];

export default function FilterBar({ basePath, shelves = [], showSort = true, showViewToggle = false }: FilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const currentShelf = searchParams.get('shelf') || 'read';
  const currentSort = searchParams.get('sort') || '-dateRead';
  const currentView = searchParams.get('view') || 'grid';
  const currentCategory = searchParams.get('category');
  const currentFormat = searchParams.get('kindle') ? 'kindle' : searchParams.get('audible') ? 'audible' : '';
  const currentRating = searchParams.get('rating') || '';

  // Check if any filters are active (not at default state)
  const hasActiveFilters =
    currentShelf !== 'read' ||
    currentSort !== '-dateRead' ||
    currentCategory !== null ||
    currentFormat !== '' ||
    currentRating !== '';

  // Add shelf parameter to URL if not present (without redirect)
  useEffect(() => {
    if (!searchParams.get('shelf')) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('shelf', 'read');
      router.replace(`${basePath}?${params.toString()}`);
    }
  }, [searchParams, basePath, router]);

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

  const clearFilters = () => {
    router.push(`${basePath}?shelf=read&sort=-dateRead`);
  };

  return (
    <div className={styles.filterBar}>
      <div className={styles.filters}>
        <select
          className={styles.select}
          value={currentShelf}
          onChange={(e) => updateFilter('shelf', e.target.value)}
        >
          <option value="all">All Shelves</option>
          {shelves.map((shelf) => (
            <option key={shelf.id} value={shelf.slug || shelf.id}>
              {shelf.name || shelf.label}
            </option>
          ))}
        </select>

        <CategoryFilter
          selectedCategory={currentCategory}
          onCategoryChange={(category) => updateFilter('category', category || '')}
          className={styles.select}
        />

        <select
          className={styles.select}
          value={currentFormat}
          onChange={(e) => {
            const value = e.target.value;
            const params = new URLSearchParams(searchParams.toString());
            params.delete('kindle');
            params.delete('audible');
            if (value) {
              params.set(value, 'true');
            }
            params.delete('page');
            router.push(`${basePath}?${params.toString()}`);
          }}
        >
          {formatOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          className={styles.select}
          value={currentRating}
          onChange={(e) => updateFilter('rating', e.target.value)}
        >
          {ratingOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
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

      <div className={styles.actions}>
        {hasActiveFilters && (
          <button
            className={styles.clearBtn}
            onClick={clearFilters}
            type="button"
          >
            Clear Filters
          </button>
        )}

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
    </div>
  );
}
