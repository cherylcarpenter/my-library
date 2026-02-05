import styles from './styles.module.scss';

interface BookGridProps {
  children: React.ReactNode;
}

export default function BookGrid({ children }: BookGridProps) {
  return (
    <div className={styles.grid}>
      {children}
    </div>
  );
}
