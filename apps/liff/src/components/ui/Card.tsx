import type { ReactNode } from 'react';

/** ★V8 のカード。白・細い枠・角丸14。幅は呼び出し側が決める。 */
export default function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-(--liff-radius-lg) border border-liff-line bg-canvas ${className}`}>{children}</div>;
}
