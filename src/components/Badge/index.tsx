import Link from 'next/link';
import HeadphonesIcon from '@/components/Icons/HeadphonesIcon';
import styles from './styles.module.scss';

type BadgeVariant = 'shelf' | 'kindle' | 'audible' | 'audible-exclusive' | 'series' | 'default';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
  href?: string;
}

function KindleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256"><path d="M192,24H64A24,24,0,0,0,40,48V208a24,24,0,0,0,24,24H192a24,24,0,0,0,24-24V48A24,24,0,0,0,192,24ZM56,72H200V184H56Zm8-32H192a8,8,0,0,1,8,8v8H56V48A8,8,0,0,1,64,40ZM192,216H64a8,8,0,0,1-8-8v-8H200v8A8,8,0,0,1,192,216Z"></path></svg>
  );
}

export default function Badge({ children, variant = 'default', className = '', href }: BadgeProps) {
  const icon = (
    <>
      {variant === 'kindle' && <KindleIcon />}
      {(variant === 'audible' || variant === 'audible-exclusive') && <HeadphonesIcon size={14} />}
    </>
  );

  const content = (
    <>
      {icon}
      {variant === 'audible-exclusive' ? 'Audible Exclusive' : children}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`${styles.badge} ${styles[variant]} ${styles.link} ${className}`}>
        {content}
      </Link>
    );
  }

  return (
    <span className={`${styles.badge} ${styles[variant]} ${className}`}>
      {content}
    </span>
  );
}
