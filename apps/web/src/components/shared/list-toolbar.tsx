'use client'

import type { ReactNode } from 'react'
import SearchField from './search-field'

/**
 * 一覧の上に置く、検索の帯。
 *
 * Pencil V5 の `n18zLK`（ツールバー）。
 *
 * 一斉配信・テンプレート・シナリオ・リマインダは、設計上どれも
 * 「一覧の上に検索の行がある」という同じ形をしている。
 * 画面ごとに書くと、間隔や並びがそのつどずれる。
 *
 * **押せない飾りは置かない。** 以前ここには、フォルダの札・並び順・
 * 表示件数・「保存した条件」が、どれも押せない形で並んでいた。
 * 押せるように見えて何も起きない操作は、運用者に「やった」と
 * 誤解させる（`docs/v6-common-rules.md` §2-2「使えないプルダウンを
 * 完成画面に置かない」、§5-5「隠すのではなく描かない」、
 * §7-10「`準備中` のボタンが1つも無い（出す＝使える）」）。
 *
 * 仕組みができた操作は `children` に渡す。帯の形は部品が持ち、
 * 中身は画面が持つ。フォルダ分けは `folder-panel.tsx` が本物なので、
 * ここに空の札を二重に並べない。
 */
export default function ListToolbar({
  searchPlaceholder,
  searchValue,
  onSearchChange,
  children,
}: {
  searchPlaceholder: string
  searchValue: string
  onSearchChange: (value: string) => void
  /**
   * 検索の右に並べる操作。**動くものだけを渡す。**
   * 並び順・表示件数を出したい画面は、実際にその順で並べてから渡す。
   */
  children?: ReactNode
}) {
  return (
    <div className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3">
      <SearchField
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
        value={searchValue}
        onChange={onSearchChange}
        onClear={() => onSearchChange('')}
        className="min-w-0 flex-1"
      />
      {children}
    </div>
  )
}
