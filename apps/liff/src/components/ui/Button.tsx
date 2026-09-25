import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * ★V7 のボタン。主 (濃い緑・白文字) は1画面に1つだけ置く。
 * 副 (白の地に枠) は読み直し・履歴へ戻るなどに使う。青のボタンは作らない。
 */
export default function Button({
  variant = 'primary',
  children,
  className = '',
  ...rest
}: {
  variant?: 'primary' | 'secondary';
  children: ReactNode;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    'flex min-h-12 w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50';
  const tone =
    variant === 'primary'
      ? 'bg-accent-deep text-white focus-visible:outline-accent-deep active:opacity-90'
      : 'border border-hairline bg-canvas text-ink focus-visible:outline-ink active:bg-ground';
  return (
    <button type="button" className={`${base} ${tone} ${className}`} {...rest}>
      {children}
    </button>
  );
}
