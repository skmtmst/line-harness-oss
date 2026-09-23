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

/* ------------------------------------------------- #667 一覧の件数表記統一 */

 /*
  * #667: 一覧の件数表記は「N件中 X〜Y件を表示」の1形式へ寄せる。
  *
  * 棚卸しでは少なくとも7種が混在していた（`前へ 1 次へ` のみ・
  * `2件中1〜2件を表示`・`0〜0件 / 全0件`・`2個中1〜2個を表示`・
  * `1つのうち1つを表示`・`5件中5件を表示しています…`・
  * `X〜Y件 / 全Z件`・`X件 / 全Y件`・`全N件` のみ）。
  * いちばん多かった「N件中 X〜Y件を表示」に合わせ、単位だけ
  * 呼び出し側から渡す（件 / 個 / つ / 頭 …）。`全` は付けない。
  * 絞り込み中の数は全体ではないので、「全」と言い切らない。
  *
  * 0件のときは `0件中 0〜0件を表示`、範囲外のページは最終頁へ
  * 丸めて `最初 > 最後` にならないようにする。
  */
export function formatPaginationSummary(
  total: number,
  page: number,
  pageSize: number,
  unit = '件',
): string {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0
  const safeSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 20
  const lastPage = Math.max(1, Math.ceil(safeTotal / safeSize))
  const current = Math.min(lastPage, safePage(page, 1))
  const first = safeTotal === 0 ? 0 : (current - 1) * safeSize + 1
  const last = Math.min(current * safeSize, safeTotal)
  const num = (value: number) => value.toLocaleString('ja-JP')
  return `${num(safeTotal)}${unit}中 ${num(first)}〜${num(last)}${unit}を表示`
}

export type ListPaginationProps = {
  /** 数える母集団（一覧が数えた総数。絞り込み中は条件に合う数）。 */
  total: number
  page: number
  pageSize: number
  pageCount: number
  onPageChange: (page: number) => void
  /** 単位。既定は `件`（`個`・`つ`・`頭` なども渡せる）。 */
  unit?: string
  ariaLabel?: string
  disabled?: boolean
  className?: string
}

/**
 * #667: 件数とページ送りを組にした一覧フッター。
 * 件数は `formatPaginationSummary` の1形式、送りは共通 `Pagination`。
 * 1ページしか無いとき送りは出ない（`Pagination` 側で決める）が、
 * 件数はいつも出す。押せない口を並べない。
 */
export function ListPagination({
  total,
  page,
  pageSize,
  pageCount,
  onPageChange,
  unit = '件',
  ariaLabel,
  disabled = false,
  className,
}: ListPaginationProps) {
  const summary = formatPaginationSummary(total, page, pageSize, unit)
  const classes = ['mt-3 flex flex-wrap items-center justify-between gap-3', className]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes}>
      <p className="text-ink-faint whitespace-nowrap text-xs tabular-nums">{summary}</p>
      <Pagination
        page={page}
        pageCount={pageCount}
        onPageChange={onPageChange}
        ariaLabel={ariaLabel}
        disabled={disabled}
      />
    </div>
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
