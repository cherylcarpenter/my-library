import Link from 'next/link';
import BookOpenIcon from '@/components/Icons/BookOpenIcon';
import styles from './not-found.module.scss';

export default function NotFound() {
  return (
    <div className={styles.notFound}>
      <div className={styles.content}>
        <BookOpenIcon className={styles.emoji} size={80} />
        <h1 className={styles.title}>Page Not Found</h1>
        <p className={styles.message}>Sorry, we couldn't find the page you're looking for.</p>
        <Link href="/" className={styles.button}>
          Back to Home
        </Link>
      </div>
    </div>
  );
}
