import styles from './styles.module.scss';

interface BookCardSkeletonProps {
  variant?: 'grid' | 'list';
}

export default function BookCardSkeleton({ variant = 'grid' }: BookCardSkeletonProps) {
  return (
    <div className={`${styles.skeleton} ${variant === 'list' ? styles.listSkeleton : ''}`}>
      <div className={styles.cover} />
      <div className={styles.info}>
        <div className={styles.title} />
        <div className={styles.author} />
        <div className={styles.badges}>
          <div className={styles.badge} />
          <div className={styles.badge} />
        </div>
      </div>
    </div>
  );
}

export function BookGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <BookCardSkeleton key={i} />
      ))}
    </>
  );
}
