import React from 'react'
import styles from './pagination.module.css'

export type PaginationItem = number | 'ellipsis'

export type PaginationProps = {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  ariaLabel?: string
  disabled?: boolean
  className?: string
}

/** Pencil の5枠に収め、先頭・現在地・末尾を常に辿れる並びを返す。 */
/**
 * ページ番号として使える数に直す。
 *
 * **`NaN` をそのまま並べない。** `Math.max(1, Math.floor(NaN))` は `NaN` なので、
 * 呼ぶ側が `total / limit` で 0 割りをすると、ページ送りに「… NaN … NaN 次へ」と
 * 出る。実際に受信箱の「やり取りの記録」が空のときそうなっていた
 * （`data.total / data.limit` が `0 / 0`）。
 *
 * ここで止めるのは、**呼ぶ側が9か所あって、そのすべてを直しても
 * 次に足す人が同じことをする**ため。
 */
function safePage(value: number, fallback: number): number {
  const floored = Math.floor(value)
  return Number.isFinite(floored) ? Math.max(1, floored) : fallback
}

export function paginationItems(page: number, pageCount: number): PaginationItem[] {
  const total = safePage(pageCount, 1)
  const current = Math.min(total, safePage(page, 1))

  if (total <= 5) return Array.from({ length: total }, (_, index) => index + 1)
  if (current <= 3) return [1, 2, 3, 'ellipsis', total]
  if (current >= total - 2) return [1, 'ellipsis', total - 2, total - 1, total]
  return [1, 'ellipsis', current, 'ellipsis', total]
}

function Ellipsis() {
  return (
    <span className={[styles.item, styles.page].join(' ')} aria-hidden="true">
      …
    </span>
  )
}

/**
 * Pencil V5/V6 の `Blot6` を正本にした共通ページネーション。
 * 見た目と省略規則は部品側に置き、呼び出し側は現在ページと変更処理だけを渡す。
 *
 * ## 送る先が無いときは描かない
 *
 * **1ページしか無い一覧に「前へ 1 次へ」を出さない。** 読み込み中や、
 * 1件も無いときにも出ていた。押せない口が並ぶと、運用者は
 * 「まだ何かあるのに出ていない」と読む。
 *
 * 画面ごとに `{pageCount > 1 && <Pagination …>}` と書くと、書き忘れた画面
 * だけ出たままになる（実際そうなっていた）。**部品の側で決める。**
 */
export default function Pagination({
  page,
  pageCount,
  onPageChange,
  ariaLabel = 'ページ送り',
  disabled = false,
  className,
}: PaginationProps) {
  const total = safePage(pageCount, 1)
  const current = Math.min(total, safePage(page, 1))
  const classes = [styles.pagination, className].filter(Boolean).join(' ')

  // 送る先が1ページだけなら、そもそも出さない。
  if (total <= 1) return null

  return (
    <nav aria-label={ariaLabel} className={classes}>
      <button
        type="button"
        className={[styles.item, styles.control].join(' ')}
        onClick={() => onPageChange(current - 1)}
        disabled={disabled || current <= 1}
        aria-label="前のページ"
      >
        前へ
      </button>
      {paginationItems(current, total).map((item, index) =>
        item === 'ellipsis' ? (
          <Ellipsis key={`ellipsis-${index}`} />
        ) : (
          <button
            type="button"
            key={item}
            className={[styles.item, styles.page, item === current ? styles.current : '']
              .filter(Boolean)
              .join(' ')}
            onClick={() => onPageChange(item)}
            disabled={disabled}
            aria-label={`${item}ページ目へ`}
            aria-current={item === current ? 'page' : undefined}
          >
            {item}
          </button>
        ),
      )}
      <button
        type="button"
        className={[styles.item, styles.control].join(' ')}
        onClick={() => onPageChange(current + 1)}
        disabled={disabled || current >= total}
        aria-label="次のページ"
      >
        次へ
      </button>
    </nav>
  )
}
