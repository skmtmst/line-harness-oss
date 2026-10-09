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
  selected = false,
  unavailable = false,
  waitlisted = false,
  full = false,
  href,
  external = false,
  ref,
  ...rest
}: {
  variant?: 'primary' | 'secondary' | 'danger' | 'text' | 'icon' | 'arrow' | 'notify' | 'chip' | 'tab' | 'option' | 'optionRow' | 'day' | 'time' | 'calendarDay' | 'overlay' | 'nightAction' | 'nightText' | 'nightSound' | 'nightSend';
  selected?: boolean;
  unavailable?: boolean;
  waitlisted?: boolean;
  full?: boolean;
  /** 回答フォームに置く外部リンクも同じボタンの形にする。 */
  href?: string;
  external?: boolean;
  children?: ReactNode;
  className?: string;
  /** 確認窓が開いたときのフォーカス移動用 (React 19 の ref-as-prop)。 */
  ref?: Ref<HTMLButtonElement>;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = 'liff-press focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50';
  const action = 'flex w-full items-center justify-center gap-2 rounded-(--liff-radius) px-4 font-bold';
  const choice = selected
    ? 'bg-liff-soft outline-2 -outline-offset-1 outline-liff-primary'
    : unavailable
      ? 'bg-liff-off-bg outline-1 -outline-offset-1 outline-liff-line'
      : 'bg-canvas outline-1 -outline-offset-1 outline-liff-line';
  const tones = {
    primary: `${action} min-h-12 bg-liff-primary text-[15px] text-(--liff-on-primary) focus-visible:outline-liff-primary active:opacity-90`,
    danger: `${action} min-h-12 bg-danger text-[15px] text-white focus-visible:outline-danger active:opacity-90`,
    secondary: `${action} min-h-11 border border-liff-line-strong bg-canvas text-sm font-semibold text-ink active:bg-liff-off-bg`,
    text: 'liff-hit inline-flex items-center justify-center gap-1 px-2 text-xs text-liff-sub',
    icon: 'liff-hit inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink disabled:text-liff-off-ink',
    arrow: 'liff-hit flex h-10 w-[18px] shrink-0 items-center justify-center text-ink disabled:text-liff-off-ink',
    notify: 'liff-hit flex h-6 w-6 items-center justify-center rounded-full bg-canvas text-liff-primary shadow outline-1 -outline-offset-1 outline-liff-line-strong',
    chip: `liff-hit inline-flex shrink-0 items-center justify-center rounded-full px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap ${selected ? 'bg-ink text-canvas' : 'bg-liff-chip text-ink'}`,
    tab: `liff-hit flex min-h-11 flex-1 items-center justify-center rounded-lg px-1 text-xs ${selected ? 'bg-canvas font-bold text-ink' : 'font-semibold text-liff-sub'}`,
    option: `liff-hit flex w-full items-center gap-3 rounded-(--liff-radius-lg) p-3.5 text-left text-sm text-ink ${choice}`,
    optionRow: `liff-hit flex min-h-11 w-full items-center justify-between gap-3 rounded-(--liff-radius) border px-4 py-2.5 text-left disabled:cursor-not-allowed ${unavailable ? 'border-hairline bg-liff-off-bg' : selected && waitlisted ? 'border-liff-wait-ink bg-liff-wait-bg' : selected ? 'border-liff-primary bg-liff-primary' : 'border-hairline bg-canvas'}`,
    day: `liff-hit flex min-w-0 flex-col items-center gap-0.5 rounded-(--liff-radius) py-2 disabled:opacity-100 ${choice}`,
    time: `liff-hit liff-num min-h-11 w-full rounded-(--liff-radius) px-1 text-[15px] disabled:opacity-100 ${selected ? 'bg-liff-primary font-bold text-(--liff-on-primary)' : unavailable ? 'bg-liff-off-bg font-medium text-liff-off-ink' : 'bg-canvas font-medium text-ink outline -outline-offset-1 outline-liff-line-strong'}`,
    calendarDay: `liff-hit flex h-11 flex-col items-center justify-center gap-0.5 rounded-(--liff-radius) font-semibold disabled:opacity-100 ${selected ? 'bg-liff-primary text-(--liff-on-primary)' : full ? 'text-liff-full' : unavailable ? 'text-liff-off-ink' : 'text-ink'}`,
    overlay: 'absolute inset-0 bg-ink/40',
    nightAction: `${action} min-h-12 bg-night-cta text-[15px] text-white`,
    nightText: 'liff-hit inline-flex items-center text-xs text-night-mine',
    nightSound: 'liff-hit pointer-events-auto inline-flex items-center gap-1 rounded-full bg-night-panel px-2.5 py-1 text-xs font-semibold text-white',
    nightSend: 'liff-hit flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-liff-primary text-white',
  };
  if (href !== undefined) {
    return <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined} className={`${base} ${tones[variant]} ${className}`} style={rest.style}>{children}</a>;
  }
  return (
    <button type="button" ref={ref} data-selected={selected || undefined} className={`${base} ${tones[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}
