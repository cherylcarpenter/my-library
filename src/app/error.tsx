'use client';

import { useEffect } from 'react';
import styles from './error.module.scss';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App error:', error);
  }, [error]);

  return (
    <div className={styles.error}>
      <div className={styles.content}>
        <span className={styles.emoji}>😕</span>
        <h1 className={styles.title}>Something went wrong</h1>
        <p className={styles.message}>
          We encountered an error loading this page.
        </p>
        <button onClick={reset} className={styles.button}>
          Try again
        </button>
      </div>
    </div>
  );
}
