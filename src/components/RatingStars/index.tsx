import styles from './styles.module.scss';

interface RatingStarsProps {
  rating: number;
  maxRating?: number;
  size?: 'sm' | 'md' | 'lg';
  showValue?: boolean;
}

export default function RatingStars({ 
  rating, 
  maxRating = 5, 
  size = 'md',
  showValue = false 
}: RatingStarsProps) {
  const stars = [];
  
  for (let i = 1; i <= maxRating; i++) {
    if (i <= rating) {
      stars.push(<span key={i} className={styles.filled}>★</span>);
    } else if (i - 0.5 <= rating) {
      stars.push(<span key={i} className={styles.half}>★</span>);
    } else {
      stars.push(<span key={i} className={styles.empty}>★</span>);
    }
  }

  return (
    <div className={`${styles.rating} ${styles[size]}`}>
      <div className={styles.stars}>{stars}</div>
      {showValue && <span className={styles.value}>{rating.toFixed(1)}</span>}
    </div>
  );
}
