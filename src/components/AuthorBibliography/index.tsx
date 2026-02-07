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

interface AuthorBibliographyProps {
  authorSlug: string;
  authorName: string;
}

export default function AuthorBibliography({ authorSlug, authorName }: AuthorBibliographyProps) {
  const [works, setWorks] = useState<Work[]>([]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let mounted = true;
    
    fetch(`/api/authors/${authorSlug}/works`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (mounted && data?.works) {
          setWorks(data.works);
        }
      })
      .catch(() => {});
      
    return () => { mounted = false; };
  }, [authorSlug]);

  const otherWorks = works.filter(w => !w.isOwned);
  const displayWorks = showAll ? otherWorks : otherWorks.slice(0, 8);
  const hasMore = otherWorks.length > 8;

  if (otherWorks.length === 0 && works.length === 0) {
    return null; // Still loading or genuinely empty
  }

  if (otherWorks.length === 0) {
    return (
      <section className={styles.bibliography}>
        <h2>Other Books by {authorName}</h2>
        <p className={styles.complete}>
          {works.length > 0 
            ? `You have all ${works.length} books by ${authorName}! 🎉`
            : 'Loading...'}
        </p>
      </section>
    );
  }

  return (
    <section className={styles.bibliography}>
      <h2>Other Books by {authorName}</h2>
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
      
      {hasMore && (
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