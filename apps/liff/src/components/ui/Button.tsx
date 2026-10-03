import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

/**
 * ★V8 のボタン。主 (濃い緑・白文字・高さ48) は1画面に1つだけ置く。
 * 副 (白の地に枠・高さ44) は読み直し・履歴へ戻るなどに使う。青のボタンは作らない。
 * 赤 (`danger`) は確認窓の取り消せない操作にだけ使う。
 * ★A: 押すと縮み色を濃くする手応え付き。
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
    'liff-press flex w-full items-center justify-center gap-2 rounded-[10px] px-4 font-bold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50';
  const tone =
    variant === 'primary'
      ? 'min-h-12 bg-liff-primary text-[15px] text-(--liff-on-primary) focus-visible:outline-liff-primary active:opacity-90'
      : variant === 'danger'
        ? 'min-h-12 bg-danger text-[15px] text-white focus-visible:outline-danger active:opacity-90'
        : 'min-h-11 border border-liff-line-strong bg-canvas text-sm font-semibold text-ink focus-visible:outline-ink active:bg-liff-off-bg';
  return (
    <button type="button" ref={ref} className={`${base} ${tone} ${className}`} {...rest}>
      {children}
    </button>
  );
}
