import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import BookCard, { Book } from '@/components/BookCard';
import BookGrid from '@/components/BookGrid';
import AuthorBibliography from '@/components/AuthorBibliography';
import styles from './page.module.scss';

// Strip HTML tags from OpenLibrary bios
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

interface AuthorDetail {
  id: string;
  name: string;
  slug: string;
  bio?: string | null;
  photoUrl?: string | null;
  birthDate?: string | null;
  deathDate?: string | null;
  openLibraryId?: string | null;
  bookCount: number;
  books: Book[];
}

async function getAuthor(slug: string): Promise<AuthorDetail | null> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/authors/${slug}`,
    { cache: 'no-store' }
  );
  if (!res.ok) return null;
  return res.json();
}

function formatLifespan(birthDate?: string | null, deathDate?: string | null): string | null {
  if (!birthDate && !deathDate) return null;
  
  const birth = birthDate || '?';
  const death = deathDate || '';
  
  if (death) {
    return `${birth} – ${death}`;
  }
  return `Born ${birth}`;
}

export default async function AuthorDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const author = await getAuthor(slug);

  if (!author) {
    notFound();
  }

  const lifespan = formatLifespan(author.birthDate, author.deathDate);

  return (
    <div className={styles.authorDetail}>
      <div className={styles.container}>
        <nav className={styles.breadcrumb}>
          <Link href="/authors">← Back to Authors</Link>
        </nav>

        <header className={styles.header}>
          <div className={styles.avatarWrapper}>
            {author.photoUrl ? (
              <Image
                src={author.photoUrl}
                alt={author.name}
                width={150}
                height={150}
                className={styles.photo}
                unoptimized
              />
            ) : (
              <div className={styles.avatar}>
                {author.name.charAt(0)}
              </div>
            )}
          </div>

          <div className={styles.headerInfo}>
            <h1>{author.name}</h1>
            {lifespan && (
              <p className={styles.lifespan}>{lifespan}</p>
            )}
            <p className={styles.bookCount}>
              {author.bookCount} {author.bookCount === 1 ? 'book' : 'books'} in your library
            </p>
            {author.openLibraryId && (
              <a 
                href={`https://openlibrary.org/authors/${author.openLibraryId}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.openLibraryLink}
              >
                View on OpenLibrary ↗
              </a>
            )}
          </div>
        </header>

        {author.bio && (
          <section className={styles.bio}>
            <h2>About {author.name.split(' ')[0]}</h2>
            <p style={{ whiteSpace: 'pre-wrap' }}>{stripHtml(author.bio)}</p>
          </section>
        )}

        <section className={styles.books}>
          <h2>In Your Library</h2>
          {author.books.length > 0 ? (
            <BookGrid>
              {author.books.map((book) => (
                <BookCard key={book.id} book={book} />
              ))}
            </BookGrid>
          ) : (
            <p className={styles.empty}>No books found</p>
          )}
        </section>

        <AuthorBibliography authorSlug={author.slug} authorName={author.name} />
      </div>
    </div>
  );
}
