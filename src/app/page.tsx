import styles from './page.module.scss';

export default function Home() {
  return (
    <main className={styles.main}>
      <div className={styles.hero}>
        <h1>My Library</h1>
        <p>A personal collection of books across Kindle, Audible, and Goodreads.</p>
      </div>
    </main>
  );
}
