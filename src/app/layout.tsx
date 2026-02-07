import type { Metadata } from 'next';
import { Roboto, Playfair_Display } from 'next/font/google';
import Providers from '@/components/Providers';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import '@/styles/globals.scss';

const roboto = Roboto({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-roboto',
  display: 'swap',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-playfair',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: "Cheryl's Library",
    template: "%s | Cheryl's Library",
  },
  description: 'A personal library tracking books, authors, and reading progress.',
  keywords: ['books', 'reading', 'library', 'book tracker'],
  authors: [{ name: 'Cheryl' }],
  openGraph: {
    title: "Cheryl's Library",
    description: 'A personal library tracking books, authors, and reading progress.',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: "Cheryl's Library",
    description: 'A personal library tracking books, authors, and reading progress.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${roboto.variable} ${playfair.variable}`}>
      <body>
        <Providers>
          <Header />
          <main>{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
