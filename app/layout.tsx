import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Etera',
  description: 'Фигурки и украшения из гипса. Приватный прототип каталога ручной работы.',
  robots: { index: false, follow: false },
  icons: { icon: '/favicon.svg' },
};
export default function RootLayout({children}: {children: React.ReactNode}) {
  return <html lang="ru"><body>{children}</body></html>;
}
