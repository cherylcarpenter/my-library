'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import styles from './styles.module.scss';

const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/books', label: 'Books' },
  { href: '/authors', label: 'Authors' },
  { href: '/series', label: 'Series' },
  { href: '/shelves', label: 'Shelves' },
];

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const { data: session, status } = useSession();

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <Link href="/" className={styles.logo}>
          <span className={styles.logoIcon}>📚</span>
          <span className={styles.logoText}>My Library</span>
        </Link>

        <nav className={`${styles.nav} ${mobileMenuOpen ? styles.navOpen : ''}`}>
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`${styles.navLink} ${pathname === link.href ? styles.active : ''}`}
              onClick={() => setMobileMenuOpen(false)}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {status === 'loading' ? (
          <span className={styles.authLoading}>...</span>
        ) : session ? (
          <div className={styles.userMenu}>
            {session.user?.image && (
              <img 
                src={session.user.image} 
                alt="" 
                className={styles.userAvatar}
              />
            )}
            <button 
              className={styles.authButton}
              onClick={() => signOut()}
            >
              Sign Out
            </button>
          </div>
        ) : (
          <Link href="/auth/signin" className={styles.authButton}>
            Sign In
          </Link>
        )}

        <button
          className={styles.mobileMenuButton}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle menu"
        >
          <span className={`${styles.hamburger} ${mobileMenuOpen ? styles.open : ''}`} />
        </button>
      </div>
    </header>
  );
}
