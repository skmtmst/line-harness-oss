'use client'
import type React from 'react'

import type { ReactNode } from 'react'
import SearchField from './search-field'
import styles from './list-toolbar.module.css'

export type ListToolbarSearch = {
  placeholder: string
  value: string
  onChange: (value: string) => void
  /**
   * 読み上げ名。渡さないときは placeholder と同じ文にする
   * （検索欄は見た目に常設ラベルが無いため）。
   */
  label?: string
  /** 入力の上限（貼り付けの制限）。渡さないときは付けない。 */
  maxLength?: number
  /** ★V8 探す欄の幅（板ごとの絵の幅。例：リマインダ apLqS は 200）。渡さないときは部品の 280。 */
  width?: number
  /** 検索中。渡すと虫眼鏡の代わりに回る印が出る。 */
  loading?: boolean
  /** 箱の右端の近道の印（例 '⌘K'）。渡すと探す欄へ飛べる。v8 だけ。 */
  shortcut?: string
}

/**
 * 一覧の上の道具の並び。★V7 `Xn1Mz`。
 *
 * どの一覧も同じ2行にする。画面ごとに手で並べない。
 *
 * - 1行目：検索（幅320・虫眼鏡つき・狭い時も240まで）→ `actions`
 *   （保存した検索・この条件を保存）。検索を横いっぱいに伸ばさない。
 *   検索を枠付きの箱（カード）で包まない。
 * - 2行目：左に `filters`（札・日付などの絞り込み）、右端に
 *   `trailing`（並び順と表示件数）。表示件数だけの行を作らない。
 *   入りきらない幅では右の2つが下へ折り返す。
 *
 * 画面の上からの順もそろえる：数のカード → 説明の開閉（Disclosure）→
 * ＋ ○○を作る（左）→ この部品 → フォルダと表。
 */
export default function ListToolbar({
  search,
  actions,
  filters,
  trailing,
  layout = 'band',
}: {
  search: ListToolbarSearch
  /** 1行目。検索の右に置く、動くものだけ（保存した検索・この条件を保存）。 */
  actions?: ReactNode
  /** 2行目・左。札・日付などの絞り込み。 */
  filters?: ReactNode
  /** 2行目・右端。並び順と表示件数。 */
  trailing?: ReactNode
  /**
   * 並べ方。既定 'band' は1本の帯（c4n9Kr）。
   * 'stacked' は2段（acRIl 予約管理：1段目＝探す・担当・経路・CSV、
   * 2段目＝札）。段の間10・段の中の間6。
   */
  layout?: 'band' | 'stacked'
}) {
  const label = search.label ?? search.placeholder
  return (
    <div className={styles.toolbar} data-toolbar-layout={layout} style={search.width ? ({ '--list-search-width': `${search.width}px` } as React.CSSProperties) : undefined}>
      <div className={styles.row1}>
        <SearchField
          placeholder={search.placeholder}
          aria-label={label}
          value={search.value}
          onChange={search.onChange}
          onClear={() => search.onChange('')}
          maxLength={search.maxLength}
          loading={search.loading}
          shortcut={search.shortcut}
          className={styles.search}
        />
        {actions}
      </div>
      {filters || trailing ? (
        <div className={styles.row2}>
          {filters ? <div className={styles.filters}>{filters}</div> : null}
          {trailing ? <div className={styles.trailing}>{trailing}</div> : null}
        </div>
      ) : null}
    </div>
  )
}
