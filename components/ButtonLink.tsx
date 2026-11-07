// Drop-in for `<Link className="button…">` that also shows a subtle pending
// dot while navigation is in flight. See LinkPendingHint for the rendering
// and docs/01-app/03-api-reference/04-functions/use-link-status.md for the
// hook behaviour. The dot stays invisible until ~100 ms into navigation, so
// fast prefetched transitions don't flash it.

import Link, { type LinkProps } from 'next/link';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import LinkPendingHint from './LinkPendingHint';

type Props = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    children: ReactNode;
  };

export default function ButtonLink({ children, ...rest }: Props) {
  return (
    <Link {...rest}>
      {children}
      <LinkPendingHint />
    </Link>
  );
}
