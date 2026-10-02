import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import styles from './disclosure.module.css'

/**
 * 開閉する欄。Pencil ★V7「開閉する欄」（V7 文書 `v9M8P8`）。
 *
 * 中身はネイティブの `<details>`/`<summary>`。キーボード（Enter・Space）と読み上げ
 * （開いている／閉じている）は最初から効く。見た目と動きだけをそろえる。
 *
 * - 閉じている時は、中に何があるかを `hint`（「3項目」など）で見せる。空の欄は作らない
 * - 高さは動かさない（周りが揺れる）。印を回し、中身を薄く出すだけ
 */
export default function Disclosure({
  title,
  hint,
  defaultOpen = false,
  size = 'standard',
  className,
  id,
  children,
}: {
  title: ReactNode
  /** 閉じている時に右へ出す要約。開くと消える。 */
  hint?: ReactNode
  defaultOpen?: boolean
  size?: 'standard' | 'compact'
  className?: string
  id?: string
  children: ReactNode
}) {
  return (
    <details
      id={id}
      open={defaultOpen || undefined}
      className={[styles.root, size === 'compact' ? styles.compact : '', className].filter(Boolean).join(' ')}
    >
      <summary className={styles.summary}>
        <span className={styles.title}>{title}</span>
        {hint ? <span className={styles.hint}>{hint}</span> : null}
        <ChevronDown aria-hidden="true" className={styles.chevron} />
      </summary>
      <div className={styles.body}>{children}</div>
    </details>
  )
}
