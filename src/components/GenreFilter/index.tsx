'use client';

import { useState, useEffect } from 'react';

interface Genre {
  id: string;
  name: string;
  slug: string;
  bookCount: number;
}

interface GenreFilterProps {
  selectedGenre: string | null;
  onGenreChange: (genre: string | null) => void;
  className?: string;
}

export default function GenreFilter({
  selectedGenre,
  onGenreChange,
  className = ''
}: GenreFilterProps) {
  const [genres, setGenres] = useState<Genre[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchGenres() {
      try {
        const res = await fetch('/api/genres');
        if (res.ok) {
          const data = await res.json();
          setGenres(data);
        }
      } catch (error) {
        console.error('Error fetching genres:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchGenres();
  }, []);

  if (loading) {
    return (
      <select className={`genre-filter ${className}`} disabled>
        <option>Loading genres...</option>
      </select>
    );
  }

  return (
    <div className="genre-filter-wrapper">
      <select
        value={selectedGenre || ''}
        onChange={(e) => onGenreChange(e.target.value || null)}
        className={`genre-filter ${className}`}
      >
        <option value="">All Genres</option>
        {genres.map((genre) => (
          <option key={genre.id} value={genre.slug}>
            {genre.name} ({genre.bookCount})
          </option>
        ))}
      </select>
    </div>
  );
}
