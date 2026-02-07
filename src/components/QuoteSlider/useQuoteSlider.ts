'use client';

import { useState, useEffect, useCallback } from 'react';
import { Quote } from './quotes';

const AUTOAdvance_MS = 6000;

export function useQuoteSlider(quotes: Quote[], interval: number = AUTOAdvance_MS) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isFading, setIsFading] = useState(false);

  const goToQuote = useCallback((index: number) => {
    const normalizedIndex = Math.max(0, Math.min(index, quotes.length - 1));
    
    if (normalizedIndex !== currentIndex) {
      setIsFading(true);
      setTimeout(() => {
        setCurrentIndex(normalizedIndex);
        setIsFading(false);
      }, 500);
    }
  }, [currentIndex, quotes.length]);

  const nextQuote = useCallback(() => {
    goToQuote((currentIndex + 1) % quotes.length);
  }, [currentIndex, goToQuote, quotes.length]);

  useEffect(() => {
    if (isPaused) return;

    const timer = setInterval(() => {
      nextQuote();
    }, interval);

    return () => clearInterval(timer);
  }, [isPaused, interval, nextQuote]);

  return { currentIndex, isFading, isPaused, setIsPaused, goToQuote, nextQuote };
}
