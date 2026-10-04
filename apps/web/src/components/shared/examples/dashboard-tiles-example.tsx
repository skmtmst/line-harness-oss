'use client'

import React, { useState } from 'react'
import { StatTilesSkeleton } from '../skeleton'
import { withViewTransition } from '../view-transition'

export type DashboardTile = {
  id: string
  label: string
  /** 表示用の文言（呼び出し側が API の実データから作る）。 */
  display: string
}

/**
 * ダッシュボードの数のタイルでの使い方の例（V8「サクサク感」D・E⑤）。
 * 読み込み中はタイルの形のスケルトン、タイルを押すと
 * つながる移り変わりで中身を入れ替える。
 */
export default function DashboardTilesExample({
  tiles,
  loading,
}: {
  tiles: DashboardTile[]
  loading: boolean
}) {
  const [activeId, setActiveId] = useState<string | null>(tiles[0]?.id ?? null)

  if (loading) return <StatTilesSkeleton count={tiles.length || 4} />
  return (
    <div>
      <ul>
        {tiles.map((tile) => (
          <li key={tile.id}>
            <button
              type="button"
              aria-current={tile.id === activeId}
              onClick={() => withViewTransition(() => setActiveId(tile.id))}
            >
              {tile.label}：{tile.display}
            </button>
          </li>
        ))}
      </ul>
      <p>{tiles.find((tile) => tile.id === activeId)?.label}の内訳を表示</p>
    </div>
  )
}
