import Link from 'next/link';
import styles from './styles.module.scss';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.brand}>
          <span className={styles.logo}>📚 My Library</span>
          <p className={styles.tagline}>Track your reading journey</p>
        </div>

        <div className={styles.links}>
          <div className={styles.linkGroup}>
            <h4>Browse</h4>
            <Link href="/books">Books</Link>
            <Link href="/authors">Authors</Link>
            <Link href="/series">Series</Link>
          </div>

          <div className={styles.linkGroup}>
            <h4>Library</h4>
            <Link href="/shelves">Shelves</Link>
            <Link href="/books?shelf=currently-reading">Currently Reading</Link>
            <Link href="/books?shelf=read">Read</Link>
          </div>
        </div>

        <div className={styles.copyright}>
          <p>© {currentYear} My Library. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
