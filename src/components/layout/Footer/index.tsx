import Link from 'next/link';
import styles from './styles.module.scss';

function BookIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 256 256" fill="currentColor"><path d="m231.65 194.55-33.19-157.8a16 16 0 0 0-19-12.39l-46.81 10.06a16.08 16.08 0 0 0-12.3 19l33.19 157.8A16 16 0 0 0 169.16 224a16.3 16.3 0 0 0 3.38-.36l46.81-10.06a16.09 16.09 0 0 0 12.3-19.03M136 50.15v-.09l46.8-10 3.33 15.87L139.33 66Zm6.62 31.47 46.82-10.05 3.34 15.9L146 97.53Zm6.64 31.57 46.82-10.06 13.3 63.24-46.82 10.06ZM216 197.94l-46.8 10-3.33-15.87 46.8-10.07 3.33 15.85zM104 32H56a16 16 0 0 0-16 16v160a16 16 0 0 0 16 16h48a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16M56 48h48v16H56Zm0 32h48v96H56Zm48 128H56v-16h48z" /></svg>
  );
}

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.brand}>
          <span className={styles.logo}>
            <BookIcon />
            My Books
          </span>
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
          <p>© {currentYear} My Books. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
