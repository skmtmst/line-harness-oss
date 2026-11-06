import type { ReactNode } from 'react';

export default function PageHeading({ children, title }: { children: ReactNode; title?: string }) {
  return <h1 className="truncate text-xl font-bold text-ink" title={title}>{children}</h1>;
}
