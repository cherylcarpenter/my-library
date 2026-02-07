'use client';

import { useState, useEffect } from 'react';

interface Category {
  id: string;
  name: string;
  slug: string;
  bookCount: number;
}

interface CategoryFilterProps {
  selectedCategory: string | null;
  onCategoryChange: (category: string | null) => void;
  className?: string;
}

export default function CategoryFilter({
  selectedCategory,
  onCategoryChange,
  className = ''
}: CategoryFilterProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCategories() {
      try {
        const res = await fetch('/api/categories');
        if (res.ok) {
          const data = await res.json();
          setCategories(data);
        }
      } catch (error) {
        console.error('Error fetching categories:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchCategories();
  }, []);

  if (loading) {
    return (
      <select className={className} disabled>
        <option>Loading...</option>
      </select>
    );
  }

  return (
    <select
      value={selectedCategory || ''}
      onChange={(e) => onCategoryChange(e.target.value || null)}
      className={className}
    >
      <option value="">All Categories</option>
      {categories.map((category) => (
        <option key={category.id} value={category.slug}>
          {category.name} ({category.bookCount})
        </option>
      ))}
    </select>
  );
}
