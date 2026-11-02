import React, { useEffect, useId, useRef } from 'react'
import styles from './pagination.module.css'

export type PaginationItem = number | 'ellipsis'
export type PaginationRange = { total: number | null | undefined; first: number; last: number; unit?: string }

export type PaginationProps = {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  ariaLabel?: string
  disabled?: boolean
  className?: string
  /**
   * ★V8（jX2Uw）：帯の左端に出す件数の文。互換経路では帯の外に従来の件数
   * 表示があるので、この中身は v8 のときだけ出る。
   */
  summary?: React.ReactNode
  /** 件数の書き方は共通部品が持つ。画面からは数値と単位だけ渡す。 */
  range?: PaginationRange
  /** 予約台帳の枠内で、絵の広めの件数帯を描く。 */
  spacing?: 'roomy' | 'restaurant'
  /** カーソル式は前・現在・次だけ。任意の番号へは移動しない。 */
  mode?: 'numbered' | 'cursor'
  /**
   * 渡された page が範囲の外（pageCount より大きい）なら、最後のページへ
   * 戻す知らせ（onPageChange）を出す。絞り込み・削除で全体が縮んだ一覧用。
   * 印のない呼び出しの動きは変えない。読み込み中（disabled）は出さない。
   * 呼ぶ側は取得の成功後・確定したページ数のときだけ描くこと。
   */
  correctOutOfRange?: boolean
}

/** 7ページまでは全て表示し、多い場合も先頭・現在地・末尾を辿れる並びを返す。 */
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

  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)
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

/** 2ページ以上のときに移動操作を出し、1ページのときは件数だけ残す。 */
export default function Pagination({
  page,
  pageCount,
  onPageChange,
  ariaLabel = 'ページ送り',
  disabled = false,
  className,
  summary,
  range,
  spacing,
  mode = 'numbered',
  correctOutOfRange = false,
}: PaginationProps) {
  const reasonId = useId()
  const total = safePage(pageCount, 1)
  const current = Math.min(total, safePage(page, 1))

  const notifiedRef = useRef<number | null>(null)
  useEffect(() => {
    // 同じ行き先への知らせは1回だけ（StrictMode の二重実行でも重ねない）。
    if (!correctOutOfRange || disabled || page <= total) {
      notifiedRef.current = null
      return
    }
    if (notifiedRef.current === total) return
    notifiedRef.current = total
    onPageChange(total)
  }, [correctOutOfRange, disabled, page, total, onPageChange])
  const classes = [styles.pagination, className].filter(Boolean).join(' ')
  const pausedReason = disabled ? '現在、ページを移動できません。' : undefined
  const previousReason = pausedReason ?? (current <= 1 ? '最初のページです。' : undefined)
  const nextReason = pausedReason ?? (current >= total ? '最後のページです。' : undefined)

  const summaryNode = range ? <span className={styles.summary} data-pagination-summary>{paginationSummary(range.total, range.first, range.last, range.unit)}</span>
    : summary ? <span className={styles.summary}>{summary}</span> : null

  if (!Number.isFinite(pageCount) || total <= 1) {
    return summaryNode ? <div data-pagination className={classes} data-spacing={spacing}>{summaryNode}</div> : null
  }

  return (
    <nav aria-label={ariaLabel} data-pagination className={classes} data-spacing={spacing}>
      {summaryNode}
      <button
        type="button"
        className={[styles.item, styles.control].join(' ')}
        onClick={() => onPageChange(current - 1)}
        disabled={disabled || current <= 1}
        aria-label="前のページ"
        title={previousReason}
        aria-describedby={previousReason ? `${reasonId}-previous` : undefined}
      >
        <span className={styles.controlLabel}>前へ</span>
        <span className={styles.controlGlyph} aria-hidden="true">
          ‹
        </span>
      </button>
      {mode === 'cursor' ? <span className={[styles.item, styles.page, styles.current].join(' ')} aria-current="page" aria-label={`${current}ページ目`}>{current}</span> : paginationItems(current, total).map((item, index) =>
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
            title={pausedReason}
            aria-describedby={pausedReason ? `${reasonId}-paused` : undefined}
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
        title={nextReason}
        aria-describedby={nextReason ? `${reasonId}-next` : undefined}
      >
        <span className={styles.controlLabel}>次へ</span>
        <span className={styles.controlGlyph} aria-hidden="true">
          ›
        </span>
      </button>
      {previousReason ? <span id={`${reasonId}-previous`} hidden>{previousReason}</span> : null}
      {nextReason ? <span id={`${reasonId}-next`} hidden>{nextReason}</span> : null}
      {pausedReason ? <span id={`${reasonId}-paused`} hidden>{pausedReason}</span> : null}
    </nav>
  )
}

/** 固定版jX2Uwの件数。人数の一覧も同じ配置で単位だけ渡す。 */
export function paginationSummary(total: number | null | undefined, from: number, to: number, unit = '件'): string {
  if (total === 0) return `0${unit}`
  const count = total != null && Number.isFinite(total) ? total.toLocaleString('ja-JP') : '—'
  const first = to > 0 ? from : 0
  return `${count}${unit}中 ${first.toLocaleString('ja-JP')}〜${to.toLocaleString('ja-JP')}${unit}`
}

/** APIのカーソル移動を保ち、共通のページ送りと同じ件数・形を出す。 */
export function CursorPagination({ page, pageSize, shown, total, hasNext, onPrevious, onNext, disabled = false, ariaLabel = 'ページ送り' }: {
  page: number; pageSize: number; shown: number; total: number | null | undefined; hasNext: boolean
  onPrevious: () => void; onNext: () => void; disabled?: boolean; ariaLabel?: string
}) {
  const current = safePage(page, 1)
  const start = shown > 0 ? (current - 1) * pageSize + 1 : 0
  const end = shown > 0 ? start + shown - 1 : 0
  const pages = total != null && Number.isFinite(total) && total >= 0 && Number.isFinite(pageSize) && pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : null
  const summary = <>{paginationSummary(total, start, end)}{pages !== null && pages > 1 ? `（全${pages.toLocaleString('ja-JP')}ページ）` : ''}</>
  return <Pagination mode="cursor" page={current} pageCount={current + (hasNext ? 1 : 0)} disabled={disabled} ariaLabel={ariaLabel}
    summary={summary}
    onPageChange={(next) => { if (next < current) onPrevious(); else if (next > current) onNext() }} />
}
