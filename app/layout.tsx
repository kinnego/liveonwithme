import './globals.css';
import Link from 'next/link';

export const metadata = {
  title: 'LiveOnWith.me — A life remembered with love',
  description: 'A peaceful place to remember someone you love, share their story and gather treasured memories.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><header className="siteHeader"><Link className="brand" href="/"><span className="brandMark">∞</span>LiveOnWith.me</Link><nav><Link href="/auth">Sign in</Link><Link className="button small" href="/create">Create a memorial</Link></nav></header>{children}<footer>Made for remembering, gently and privately.</footer></body></html>;
}
