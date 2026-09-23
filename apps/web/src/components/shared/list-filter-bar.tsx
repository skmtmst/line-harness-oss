import type { ReactNode } from 'react'
import styles from './list-filter-bar.module.css'

/* ------------------------------------------------- #668 フィルターバー統一 */

 /*
  * #668: 一覧の上の操作帯（検索・絞り込み・並び替え・表示件数）の
  * 並びとラベルをそろえる受け皿。`ListToolbar`（検索だけの帯）の
  * 上位。画面ごとに `div` で組むと間隔と並びがそのつどずれる。
  *
  * 規則（棚卸しで混在していた点の答え）。
  *
  * 1. 検索は独立した全幅の行にする。表示件数と同じ行に押し込むと
  *    狭い幅で入力欄が潰れて語が読めなくなる（U014/U016の実績）。
  * 2. 次の行へ、絞り込み → 並び替え → 表示件数の順に置く。
  *    呼び出し側は `children`（または `filters`・`sort`・`pageSize`）
  *    をこの順で渡す。部品は並べ替えない。
  * 3. 並び替え・表示件数・絞り込みには見えるラベルを付ける
  *    （`FilterControl`）。`aria-label` だけの素の選択欄は、
  *    それが操作か表示か運用者に判別できない（02の指摘）。
  *    ラベルは `並び順`・`表示件数`・`絞り込み` に固定する。
  * 4. 押せない文字は操作の形にしない。件数の読み上げは素の `p`、
  *    選べるものだけを選択欄にする。素テキストに枠や矢印を付けない。
  * 5. 選択欄は自分の選択値を省略しない。長い選択肢
  *    （例: `使われている数が多い順`）が枠に収まらない画面があった
  *    ので、並び替えには `FilterControl wide` を使い、枠を
  *    内容に合わせて広げる（`min-width` 保証・CSS側）。
  * 6. `保存した検索` は選択欄＋保存ボタンの組にし、
  *    ボタン・チップ・未接続表示の4種混在をここへ寄せていく。
  */

export type ListFilterBarProps = {
  /** 検索の行。全幅で1行にする。無い画面は渡さない。 */
  search?: ReactNode
  /** 絞り込み（チップ・選択欄など）。 */
  filters?: ReactNode
  /** 並び替え（`FilterControl label="並び順"` で包む）。 */
  sort?: ReactNode
  /** 表示件数（`FilterControl label="表示件数"` で包む）。 */
  pageSize?: ReactNode
  /**
   * 上の4枠に収まらない追加の操作。**動くものだけを渡す。**
   * 順序は 絞り込み → 並び替え → 表示件数 を守る。
   */
  children?: ReactNode
  className?: string
}

export default function ListFilterBar({
  search,
  filters,
  sort,
  pageSize,
  children,
  className,
}: ListFilterBarProps) {
  const hasControls = Boolean(filters ?? sort ?? pageSize ?? children)
  if (!search && !hasControls) return null
  const classes = [styles.bar, className].filter(Boolean).join(' ')
  return (
    <div className={classes}>
      {search ? (
        <div data-search-row className={styles.searchRow}>
          {search}
        </div>
      ) : null}
      {hasControls ? (
        <div className={styles.controlsRow}>
          {filters}
          {sort}
          {pageSize}
          {children}
        </div>
      ) : null}
    </div>
  )
}

export type FilterControlProps = {
  /** 見える接頭ラベル。`並び順`・`表示件数`・`絞り込み` のどれか。 */
  label: string
  children: ReactNode
  /**
   * 並び替えなど選択肢が長い枠に付ける。枠を内容に合わせて広げ、
   * 自分の選択値を省略表示にしない。
   */
  wide?: boolean
  className?: string
}

/**
 * #668: 選択欄の見えるラベル。操作か表示か分からない素の選択欄を
 * 無くすための包み。`label` と中の操作の `aria-label` は同じ語にする。
 */
export function FilterControl({ label, children, wide = false, className }: FilterControlProps) {
  const classes = [styles.control, wide ? styles.wide : '', className].filter(Boolean).join(' ')
  return (
    <span className={classes}>
      <span className={styles.label}>{label}</span>
      {children}
    </span>
  )
}
