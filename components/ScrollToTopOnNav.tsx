'use client';
// Scrolls the window to the top whenever the pathname changes. Next's App
// Router preserves scroll on link navigation in cases we don't want (e.g.
// clicking a card mid-scroll on the dashboard would land the next page
// mid-scroll too).
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

export default function ScrollToTopOnNav() {
  const pathname = usePathname();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
