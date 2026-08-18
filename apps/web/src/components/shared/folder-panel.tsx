'use client'

import { type ReactNode } from 'react'

/**
 * 一覧の左に置くフォルダの縦パネル。
 *
 * 設計では友だち属性（タグ・友だち情報欄）がどちらもこの形をしている。
 * 以前は一覧の上に横の帯として並べていたが、分類が増えると折り返して
 * 2段3段になり、その下の検索や表が押し下げられていた。縦なら増えても
 * 幅が変わらない。
 *
 * 中身の作り（何を数えるか、消せるか）は画面ごとに違うので、
 * 行の一覧だけ受けて、下に足すものは children で受ける。
 */
export interface FolderPanelRow {
  id: string
  label: string
  count: number
  /**
   * フォルダの色（#RRGGBB）。115 で folders.color を足した。
   * 未設定は null。色はフォルダに付き、属するタグに出る。
   */
  color?: string | null
  /**
   * 直せる行だけ渡す。「すべて」「未分類」は直せない。
   *
   * 以前は × を出して消すだけだった。名前も色も変えられず、
   * 直したいときに作り直すしかなかった。
   */
  onEdit?: () => void
}

export default function FolderPanel({
  rows,
  activeId,
  onSelect,
  total,
  children,
}: {
  rows: FolderPanelRow[]
  activeId: string
  onSelect: (id: string) => void
  /** 見出しの右に出す総数。単位は画面ごとに違うので文字で受ける。 */
  total: string
  /** 下に足すもの（分類の追加など）。 */
  children?: ReactNode
}) {
  return (
    <aside className="bg-canvas rounded-card border-hairline h-fit overflow-hidden border">
      <div className="border-hairline flex items-center justify-between border-b px-4 py-3">
        <p className="text-ink text-sm font-semibold">フォルダ</p>
        <span className="text-ink-faint text-xs tabular-nums">{total}</span>
      </div>
      <nav className="p-2">
        {rows.map((row) => (
          <div key={row.id} className="group flex items-center">
            <button
              onClick={() => onSelect(row.id)}
              className={`rounded-control flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                activeId === row.id
                  ? 'bg-accent-soft text-accent font-medium'
                  : 'text-ink-secondary hover:bg-canvas-sunken'
              }`}
            >
              {/* 色が付いているフォルダは丸で出す。フォルダの形を塗ると、
                  色が面で乗って名前より目立ってしまう。 */}
              {row.color ? (
                <span
                  className="rounded-pill h-3 w-3 shrink-0"
                  style={{ backgroundColor: row.color }}
                  aria-hidden="true"
                />
              ) : (
                <svg
                  className="h-4 w-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"
                  />
                </svg>
              )}
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              <span className="text-ink-faint shrink-0 text-xs tabular-nums">{row.count}</span>
            </button>
            {/* 直す入口は行にカーソルを置いたときだけ。常に出していると、
                選ぶつもりで押し間違える。消すのは編集の中に置く。 */}
            {row.onEdit && (
              <button
                onClick={row.onEdit}
                aria-label={`フォルダ「${row.label}」を編集`}
                title={`フォルダ「${row.label}」の名前と色を変える`}
                className="text-ink-faint hover:text-accent px-1.5 text-xs opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
              >
                編集
              </button>
            )}
          </div>
        ))}
      </nav>
      {children && <div className="border-hairline space-y-2 border-t p-3">{children}</div>}
    </aside>
  )
}
