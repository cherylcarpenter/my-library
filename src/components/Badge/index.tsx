import styles from './styles.module.scss';

type BadgeVariant = 'shelf' | 'kindle' | 'audible' | 'series' | 'default';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export default function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[variant]} ${className}`}>
      {variant === 'kindle' && '📱 '}
      {variant === 'audible' && '🎧 '}
      {children}
    </span>
  );
}
