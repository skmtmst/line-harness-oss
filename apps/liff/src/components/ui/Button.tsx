import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

/**
 * ★V7 のボタン。主 (濃い緑・白文字) は1画面に1つだけ置く。
 * 副 (白の地に枠) は読み直し・履歴へ戻るなどに使う。青のボタンは作らない。
 * 赤 (`danger`) は確認窓の取り消せない操作にだけ使う。
 */
export default function Button({
  variant = 'primary',
  children,
  className = '',
  ref,
  ...rest
}: {
  variant?: 'primary' | 'secondary' | 'danger';
  children: ReactNode;
  className?: string;
  /** 確認窓が開いたときのフォーカス移動用 (React 19 の ref-as-prop)。 */
  ref?: Ref<HTMLButtonElement>;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    'flex min-h-12 w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50';
  const tone =
    variant === 'primary'
      ? 'bg-accent-deep text-white focus-visible:outline-accent-deep active:opacity-90'
      : variant === 'danger'
        ? 'bg-danger text-white focus-visible:outline-danger active:opacity-90'
        : 'border border-hairline bg-canvas text-ink focus-visible:outline-ink active:bg-ground';
  return (
    <button type="button" ref={ref} className={`${base} ${tone} ${className}`} {...rest}>
      {children}
    </button>
  );
}
