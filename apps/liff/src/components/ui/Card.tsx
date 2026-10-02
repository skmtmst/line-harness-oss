import type { ReactNode } from 'react';

/** ★V7 のカード。白・枠・角丸12。幅は呼び出し側が決める。 */
export default function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-hairline bg-canvas ${className}`}>{children}</div>;
}
