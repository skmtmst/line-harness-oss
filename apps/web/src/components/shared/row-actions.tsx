import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './row-actions.module.css'

type Base = { className?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>

function IconButton({
  label,
  tone,
  grip,
  className,
  children,
  ...rest
}: Base & { label: string; tone?: 'danger'; grip?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={[styles.action, tone === 'danger' && styles.danger, grip && styles.grip, className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
}

/**
 * 並び替えハンドル。Pencil V5 の `K65Uhe`。★V5 で75回。
 *
 * **行の先頭に置く。** 右の操作列に混ぜない。
 */
export function DragHandle({ label = '並び替える', ...rest }: Base & { label?: string }) {
  return (
    <IconButton label={label} grip {...rest}>
      <svg className={styles.icon} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <circle cx="9" cy="6" r="1.6" />
        <circle cx="15" cy="6" r="1.6" />
        <circle cx="9" cy="12" r="1.6" />
        <circle cx="15" cy="12" r="1.6" />
        <circle cx="9" cy="18" r="1.6" />
        <circle cx="15" cy="18" r="1.6" />
      </svg>
    </IconButton>
  )
}

/**
 * 削除。Pencil V5 の `Ls12y`。★V5 で75回。
 *
 * 押した先では必ず確認を出す。消える件数と、参照している場所を先に見せる。
 */
export function DeleteAction({ label = '削除する', ...rest }: Base & { label?: string }) {
  return (
    <IconButton label={label} tone="danger" {...rest}>
      <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
        <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </IconButton>
  )
}

/**
 * その他操作（…）。Pencil V5 の `H0V8EK`。
 */
export function MoreAction({ label = 'そのほかの操作', ...rest }: Base & { label?: string }) {
  return (
    <IconButton label={label} {...rest}>
      <svg className={styles.icon} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <circle cx="5" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="19" cy="12" r="1.8" />
      </svg>
    </IconButton>
  )
}
