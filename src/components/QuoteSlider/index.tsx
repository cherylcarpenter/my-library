'use client';

import { useQuoteSlider } from './useQuoteSlider';
import { quotes } from './quotes';
import styles from './styles.module.scss';

export default function QuoteSlider() {
  const { currentIndex, isFading, isPaused, setIsPaused, goToQuote } = useQuoteSlider(quotes, 6000);

  return (
    <section 
      className={styles.slider}
      role="region"
      aria-label="Literary quotes"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className={`${styles.container} ${isFading ? styles.fading : ''}`}>
        <blockquote className={styles.quote}>
          <p>"{quotes[currentIndex].text}"</p>
          <cite>{quotes[currentIndex].author}</cite>
        </blockquote>
      </div>

      <div 
        className={styles.dots} 
        role="tablist" 
        aria-label="Quote navigation"
      >
        {quotes.map((_, index) => (
          <button
            key={index}
            className={`${styles.dot} ${index === currentIndex ? styles.active : ''}`}
            onClick={() => goToQuote(index)}
            role="tab"
            aria-selected={index === currentIndex}
            aria-label={`Quote ${index + 1} of ${quotes.length}`}
          />
        ))}
      </div>
    </section>
  );
}
