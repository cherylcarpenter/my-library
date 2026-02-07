'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import styles from './styles.module.scss';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

interface AuthorLetterFilterProps {
  className?: string;
}

export default function AuthorLetterFilter({ className = '' }: AuthorLetterFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentLetter = searchParams.get('letter') || '';

  const updateLetter = (letter: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (letter) {
      params.set('letter', letter);
    } else {
      params.delete('letter');
    }
    params.delete('page'); // Reset to page 1
    router.push(`/authors?${params.toString()}`);
  };

  const clearFilter = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('letter');
    params.delete('page');
    router.push(`/authors?${params.toString()}`);
  };

  return (
    <div className={`${styles.letterFilter} ${className}`}>
      <div className={styles.letters}>
        <button
          className={`${styles.letter} ${!currentLetter ? styles.active : ''}`}
          onClick={() => updateLetter('')}
        >
          All
        </button>
        {ALPHABET.map((letter) => (
          <button
            key={letter}
            className={`${styles.letter} ${currentLetter === letter ? styles.active : ''}`}
            onClick={() => updateLetter(letter)}
          >
            {letter}
          </button>
        ))}
      </div>
      {currentLetter && (
        <button className={styles.clearBtn} onClick={clearFilter}>
          Clear
        </button>
      )}
    </div>
  );
}
