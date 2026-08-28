'use client'

import { type ReactNode, useState } from 'react'

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
  /** 「よく使う」の星など、フォルダ以外の固定行に出す印。 */
  icon?: ReactNode
  /**
   * 直せる行だけ渡す。「すべて」「未分類」は直せない。
   *
   * 以前は × を出して消すだけだった。名前も色も変えられず、
   * 直したいときに作り直すしかなかった。
   */
  onEdit?: () => void
  /** V6の「…」メニューを出す行だけ渡す。 */
  onRename?: () => void
  onChangeColor?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onDelete?: () => void
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
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  const runAction = (action: (() => void) | undefined) => {
    setOpenMenuId(null)
    action?.()
  }

  return (
    <aside className="bg-canvas rounded-card border-hairline h-fit border">
      <div className="border-hairline flex items-center justify-between border-b px-4 py-3">
        <p className="text-ink text-sm font-semibold">フォルダ</p>
        <span className="text-ink-faint text-xs tabular-nums">{total}</span>
      </div>
      <nav className="p-2">
        {rows.map((row) => (
          <div key={row.id} className="group relative flex items-center">
            <button
              onClick={() => {
                setOpenMenuId(null)
                onSelect(row.id)
              }}
              className={`rounded-control flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                activeId === row.id
                  ? 'bg-accent-soft text-accent font-medium'
                  : 'text-ink-secondary hover:bg-canvas-sunken'
              }`}
            >
              {/* 色が付いているフォルダは丸で出す。フォルダの形を塗ると、
                  色が面で乗って名前より目立ってしまう。 */}
              {row.icon ? (
                <span className="shrink-0" aria-hidden="true">{row.icon}</span>
              ) : row.color ? (
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
            {(row.onRename || row.onChangeColor || row.onMoveUp || row.onMoveDown || row.onDelete) ? (
              <>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setOpenMenuId((current) => current === row.id ? null : row.id)
                  }}
                  aria-label={`フォルダ「${row.label}」を操作`}
                  aria-expanded={openMenuId === row.id}
                  className="text-ink-faint hover:text-accent rounded-control px-2 py-1 text-base"
                >
                  …
                </button>
                {openMenuId === row.id && (
                  <div className="bg-canvas border-hairline absolute left-3 top-full z-20 mt-1 w-52 rounded-control border py-1 shadow-lg">
                    {row.onRename && (
                      <button type="button" onClick={() => runAction(row.onRename)} className="hover:bg-canvas-sunken w-full px-3 py-2 text-left text-sm">
                        名前を変更
                      </button>
                    )}
                    {row.onChangeColor && (
                      <button type="button" onClick={() => runAction(row.onChangeColor)} className="hover:bg-canvas-sunken w-full px-3 py-2 text-left text-sm">
                        色を変える
                      </button>
                    )}
                    {row.onMoveUp && (
                      <button type="button" onClick={() => runAction(row.onMoveUp)} className="hover:bg-canvas-sunken w-full px-3 py-2 text-left text-sm">
                        並び順を上へ
                      </button>
                    )}
                    {row.onMoveDown && (
                      <button type="button" onClick={() => runAction(row.onMoveDown)} className="hover:bg-canvas-sunken w-full px-3 py-2 text-left text-sm">
                        並び順を下へ
                      </button>
                    )}
                    {row.onDelete && (
                      <div className="border-hairline mt-1 border-t">
                        <button type="button" onClick={() => runAction(row.onDelete)} className="text-danger hover:bg-danger-bg w-full px-3 py-2 text-left text-sm">
                          フォルダを削除
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : row.onEdit ? (
              <button
                type="button"
                onClick={row.onEdit}
                aria-label={`フォルダ「${row.label}」を編集`}
                title={`フォルダ「${row.label}」の名前と色を変える`}
                className="text-ink-faint hover:text-accent px-1.5 text-xs opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
              >
                編集
              </button>
            ) : null}
          </div>
        ))}
      </nav>
      {children && <div className="border-hairline space-y-2 border-t p-3">{children}</div>}
    </aside>
  )
}
