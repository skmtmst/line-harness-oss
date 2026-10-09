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
  full = false,
  className = '',
  ref,
  ...rest
}: {
  variant?: 'primary' | 'secondary' | 'danger' | 'text' | 'choice' | 'icon' | 'backdrop' | 'calendar' | 'weekday' | 'row' | 'chip' | 'night-cta' | 'night-text' | 'sound' | 'send';
  children?: ReactNode;
  full?: boolean;
  className?: string;
  /** 確認窓が開いたときのフォーカス移動用 (React 19 の ref-as-prop)。 */
  ref?: Ref<HTMLButtonElement>;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    'liff-press flex w-full items-center justify-center gap-2 rounded-(--liff-radius) px-4 font-bold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50';
  const selected = rest['aria-pressed'] === true || rest['aria-pressed'] === 'true' || rest['aria-checked'] === true || rest['aria-checked'] === 'true';
  const focus = 'liff-press focus-visible:outline-2 focus-visible:outline-ink';
  const variants: Record<string, string> = {
    backdrop: 'absolute inset-0 bg-ink/40',
    icon: `${focus} inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink disabled:opacity-50`,
    text: `${focus} inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 text-xs text-liff-sub disabled:opacity-50`,
    choice: `${focus} flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-(--liff-radius) border border-liff-line-strong px-1 py-2 text-sm disabled:bg-liff-off-bg disabled:text-liff-off-ink ${selected ? 'bg-liff-primary font-bold text-(--liff-on-primary)' : 'bg-canvas text-ink'}`,
    calendar: `${focus} flex h-11 flex-col items-center justify-center gap-0.5 rounded-(--liff-radius) font-semibold disabled:text-liff-off-ink ${selected ? 'bg-liff-primary text-(--liff-on-primary)' : full ? 'text-liff-full' : 'text-ink'}`,
    weekday: `${focus} flex min-h-11 flex-col items-center gap-0.5 rounded-(--liff-radius) py-2 outline -outline-offset-1 disabled:bg-liff-off-bg disabled:text-liff-off-ink ${selected ? 'bg-liff-soft outline-2 outline-liff-primary' : 'bg-canvas outline-1 outline-liff-line'}`,
    row: `${focus} flex min-h-11 w-full items-center gap-3 rounded-(--liff-radius-lg) p-3.5 text-left outline -outline-offset-1 ${selected ? 'bg-liff-soft outline-2 outline-liff-primary' : 'bg-canvas outline-1 outline-liff-line'}`,
    chip: `${focus} inline-flex min-h-11 items-center justify-center rounded-full border px-3 text-xs ${selected ? 'border-liff-primary bg-liff-soft font-bold text-liff-primary' : 'border-liff-line bg-canvas text-ink'}`,
    'night-cta': `${focus} flex min-h-12 w-full items-center justify-center rounded-xl bg-night-cta text-[15px] font-bold text-white`,
    'night-text': `${focus} inline-flex min-h-11 items-center justify-center text-night-mine disabled:opacity-50`,
    sound: `${focus} pointer-events-auto inline-flex min-h-11 items-center gap-1 rounded-full bg-black/60 px-2.5 text-xs font-semibold text-white`,
    send: `${focus} flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-liff-primary text-white disabled:opacity-50`,
  };
  const tone =
    variant === 'primary'
      ? 'min-h-12 bg-liff-primary text-[15px] text-(--liff-on-primary) focus-visible:outline-liff-primary active:opacity-90'
      : variant === 'danger'
        ? 'min-h-12 bg-danger text-[15px] text-white focus-visible:outline-danger active:opacity-90'
        : 'min-h-11 border border-liff-line-strong bg-canvas text-sm font-semibold text-ink focus-visible:outline-ink active:bg-liff-off-bg';
  return (
    <button type="button" ref={ref} className={`${variants[variant] ?? `${base} ${tone}`} ${className}`} {...rest}>
      {children}
    </button>
  );
}
