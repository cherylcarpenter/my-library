'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import styles from './styles.module.scss';

interface Work {
  key: string;
  title: string;
  coverUrl: string | null;
  firstPublishYear: number | string | null;
  isOwned: boolean;
  ownedBookSlug: string | null;
  openLibraryUrl: string;
}

interface SeriesBibliographyProps {
  seriesSlug: string;
  seriesName: string;
}

export default function SeriesBibliography({ seriesSlug, seriesName }: SeriesBibliographyProps) {
  const [works, setWorks] = useState<Work[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let mounted = true;
    
    fetch(`/api/series/${seriesSlug}/works`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (mounted && data?.works) {
          setWorks(data.works);
        }
        if (mounted) setLoading(false);
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });
      
    return () => { mounted = false; };
  }, [seriesSlug]);

  const otherWorks = works.filter(w => !w.isOwned);
  const displayWorks = showAll ? otherWorks : otherWorks.slice(0, 8);
  const hasMore = otherWorks.length > 8;

  if (loading) {
    return (
      <section className={styles.bibliography}>
        <h2>Other Books in {seriesName}</h2>
        <p className={styles.loading}>Loading...</p>
      </section>
    );
  }

  if (otherWorks.length === 0 && works.length === 0) {
    return null;
  }

  if (otherWorks.length === 0) {
    return (
      <section className={styles.bibliography}>
        <h2>Other Books in {seriesName}</h2>
        <p className={styles.complete}>
          {works.length > 0 
            ? `You have all ${works.length} books in this series! 🎉`
            : 'No additional books found on OpenLibrary'}
        </p>
      </section>
    );
  }

  return (
    <section className={styles.bibliography}>
      <h2>Other Books in {seriesName}</h2>
      <p className={styles.subtitle}>
        {otherWorks.length} more {otherWorks.length === 1 ? 'book' : 'books'} not in your library
      </p>
      
      <div className={styles.worksGrid}>
        {displayWorks.map((work) => (
          <a
            key={work.key}
            href={work.openLibraryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.workCard}
          >
            <div className={styles.coverWrapper}>
              {work.coverUrl ? (
                <Image
                  src={work.coverUrl}
                  alt={work.title}
                  width={80}
                  height={120}
                  className={styles.cover}
                  unoptimized
                />
              ) : (
                <div className={styles.noCover}>
                  <span>📖</span>
                </div>
              )}
            </div>
            <div className={styles.workInfo}>
              <h3>{work.title}</h3>
              {work.firstPublishYear && (
                <p className={styles.year}>{work.firstPublishYear}</p>
              )}
              <p className={styles.viewLink}>View on OpenLibrary ↗</p>
            </div>
          </a>
        ))}
      </div>
      
      {hasMore && !showAll && (
        <button 
          className={styles.showMore}
          onClick={() => setShowAll(true)}
        >
          Show all {otherWorks.length} books
        </button>
      )}
    </section>
  );
}
