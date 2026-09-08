'use client'

import { useState, type CSSProperties, type ReactNode } from 'react'
import Button from './button'

/** テンプレート一覧を正とする、全画面共通のフォルダ欄幅。 */
export const FOLDER_RAIL_WIDTH = '15.75rem'
export const FOLDER_RAIL_STYLE = {
  '--folder-rail-width': FOLDER_RAIL_WIDTH,
} as CSSProperties

/**
 * 一覧の左に置くフォルダの縦パネル。
 *
 * Pencil V5 の `Pw4WX`（共通 フォルダレール）。
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
  /**
   * 並び順を動かす。**端の行には渡さない**（押せない口を置かない）。
   * 設計 `CzndJ` の「並び順を上へ／下へ」。
   */
  onMoveUp?: () => void
  onMoveDown?: () => void
  /** 消す。設計 `CzndJ` の「フォルダを削除」。 */
  onDelete?: () => void
  /**
   * 消す前に読ませる一言。**中身がどうなるかを、押す前に書く。**
   *
   * 設計 `CzndJ` は「削除しても、中のテンプレートは未分類に残ります。」。
   * **この部品はテンプレートにも属性にも使う**ので、言葉は呼ぶ側が決める。
   * ここで「テンプレート」と書くと、ほかの画面で嘘になる。
   */
  deleteNote?: string
  /** 画像確認で、この行の操作メニューを開くための実Node。 */
  qaOpen?: string
}

export default function FolderPanel({
  rows,
  activeId,
  onSelect,
  total,
  heading = 'フォルダ',
  onAddFolder,
  addFolderLabel = 'フォルダを追加',
  addFolderDisabled = false,
  addFolderTitle,
  addFolderNote,
  children,
}: {
  rows: FolderPanelRow[]
  activeId: string
  onSelect: (id: string) => void
  /** 見出しの右に出す総数。単位は画面ごとに違うので文字で受ける。 */
  total: string
  /** 予約管理の「メニュー」など、分類の呼び名が異なる画面で使う。 */
  heading?: string
  /** 一覧の下に置く追加操作。道具列へ重複して置かない。 */
  onAddFolder?: () => void
  addFolderLabel?: string
  addFolderDisabled?: boolean
  addFolderTitle?: string
  /** テンプレート画面と同じ位置に出す、追加操作の補足。 */
  addFolderNote?: ReactNode
  /** 下に足すもの（分類の追加など）。 */
  children?: ReactNode
}) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const runAction = (action: (() => void) | undefined) => {
    setOpenMenuId(null)
    action?.()
  }

  return (
    // **読み上げ名を持つ。** 帯が何の分類かを、見出しの外からも辿れるように。
    <aside aria-label={heading} className="bg-canvas rounded-card border-hairline h-fit overflow-visible border">
      <div className="border-hairline flex items-center justify-between border-b px-4 py-3">
        <p className="text-ink text-sm font-semibold">{heading}</p>
        <span className="text-ink-faint text-xs tabular-nums">{total}</span>
      </div>
      <nav className="p-2">
        {rows.map((row) => {
          const hasActions = Boolean(row.onEdit || row.onMoveUp || row.onMoveDown || row.onDelete)

          return (
            <div key={row.id} className="group relative flex items-center">
              <button
                type="button"
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
              {/* 操作は設計どおり1つの「…」へまとめる。行に5個の小さな口を
                  並べると、選択との押し間違いが増え、短い名前も狭くなる。 */}
              {hasActions && (
                <div
                  className="relative shrink-0"
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) setOpenMenuId(null)
                  }}
                >
                  <button
                    type="button"
                    data-qa-open={row.qaOpen}
                    onClick={() => setOpenMenuId((current) => (current === row.id ? null : row.id))}
                    aria-label={`フォルダ「${row.label}」の操作`}
                    aria-haspopup="menu"
                    aria-expanded={openMenuId === row.id}
                    title={`フォルダ「${row.label}」の操作`}
                    className="text-ink-faint hover:bg-canvas-sunken hover:text-accent rounded-control min-h-8 min-w-8 text-lg leading-none opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                  >
                    …
                  </button>
                  {openMenuId === row.id && (
                    <div
                      role="menu"
                      aria-label={`フォルダ「${row.label}」の操作`}
                      className="bg-canvas border-hairline rounded-card absolute top-full right-0 z-30 mt-1 w-52 border p-1.5 shadow-lg"
                    >
                      {row.onEdit && (
                        <>
                          <button type="button" role="menuitem" onClick={() => runAction(row.onEdit)} className="text-ink-secondary hover:bg-canvas-sunken rounded-control block w-full px-3 py-2 text-left text-sm">
                            名前を変更
                          </button>
                          <button type="button" role="menuitem" onClick={() => runAction(row.onEdit)} className="text-ink-secondary hover:bg-canvas-sunken rounded-control block w-full px-3 py-2 text-left text-sm">
                            色を変える
                          </button>
                        </>
                      )}
                      {/* 端の行にはコールバックが渡らないため、押せない項目も出ない。 */}
                      {row.onMoveUp && (
                        <button type="button" role="menuitem" onClick={() => runAction(row.onMoveUp)} className="text-ink-secondary hover:bg-canvas-sunken rounded-control block w-full px-3 py-2 text-left text-sm">
                          並び順を上へ
                        </button>
                      )}
                      {row.onMoveDown && (
                        <button type="button" role="menuitem" onClick={() => runAction(row.onMoveDown)} className="text-ink-secondary hover:bg-canvas-sunken rounded-control block w-full px-3 py-2 text-left text-sm">
                          並び順を下へ
                        </button>
                      )}
                      {row.onDelete && (
                        <button type="button" role="menuitem" onClick={() => runAction(row.onDelete)} title={row.deleteNote ?? 'フォルダを削除'} className="text-danger hover:bg-danger-bg rounded-control block w-full px-3 py-2 text-left text-sm">
                          フォルダを削除
                        </button>
                      )}
                      {row.deleteNote && <p className="text-ink-faint border-hairline mt-1 border-t px-3 pt-2 text-xs leading-relaxed">{row.deleteNote}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </nav>
      {(onAddFolder || addFolderDisabled || addFolderNote || children) && (
        <div className="border-hairline space-y-2 border-t p-3">
          {(onAddFolder || addFolderDisabled) && (
            <Button
              type="button"
              onClick={onAddFolder}
              disabled={addFolderDisabled}
              title={addFolderTitle}
              className="w-full"
            >
              {addFolderLabel}
            </Button>
          )}
          {addFolderNote}
          {children}
        </div>
      )}
    </aside>
  )
}
