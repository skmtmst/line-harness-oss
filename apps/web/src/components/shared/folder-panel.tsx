'use client'

import { useState, type CSSProperties, type ReactNode } from 'react'
import ActionMenu, { type ActionMenuItem } from './action-menu'
import Button from './button'
import { ArrowDown, ArrowUp, Ellipsis, FolderOpen, FolderPlus, Palette, Pencil, Trash2 } from 'lucide-react'
import { useAdminTheme } from '@/lib/use-admin-theme'
import styles from './folder-panel.module.css'

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
  /**
   * このフォルダに属する件数。`null` は「数えていない」（#631）。
   *
   * 母集団が確立できていない口では、`0` と嘘をつくより出さない方がよい。
   * `null` のときは何も出さない（★V7：以前の `—` は並ぶと意味の無い記号の列に見えた）。
   */
  count: number | null
  /**
   * フォルダの色（#RRGGBB）。115 で folders.color を足した。
   * 未設定は null。色はフォルダに付き、属するタグに出る。
   */
  color?: string | null
  /** V8 の分類の印。「すべて」などは呼び出し側が渡す。 */
  icon?: ReactNode
  /**
   * 直せる行だけ渡す。「すべて」「未分類」は直せない。
   *
   * 以前は × を出して消すだけだった。名前も色も変えられず、
   * 直したいときに作り直すしかなかった。
   */
  onEdit?: () => void
  /** 色を持たないフォルダ（統括のひな形の分類など）は false。「色を変える」を出さない。 */
  colorEditable?: boolean
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

/**
 * フォルダ行の操作メニューの中身（★V7 共通 ActionMenu）。
 * できることは変えない。端の行にはコールバックが渡らないため、
 * 押せない項目も出ない。削除は区切りの後・赤で最後に置く。
 */
function folderMenuItems(
  row: FolderPanelRow,
  runAction: (action: (() => void) | undefined) => void,
  v8 = false,
): ActionMenuItem[] {
  /*
   * ★V8（V8.pen 共通部品4 の H・nH0fZ、B-35 2026-10-08）：言葉は 名前を変える・色を変える・並べ替える・消す。
   * 印を左に付ける。並べ替えは隣と入れ替える口なので、上へ・下へを括弧で添える。v7 は今までの言葉のまま。
   */
  const label = v8
    ? { rename: '名前を変える', color: '色を変える', up: '並べ替える（上へ）', down: '並べ替える（下へ）', remove: '消す' }
    : { rename: '名前を変更', color: '色を変える', up: '並び順を上へ', down: '並び順を下へ', remove: 'フォルダを削除' }
  const icon = (node: ReactNode) => (v8 ? node : undefined)
  const items: ActionMenuItem[] = []
  if (row.onEdit) {
    items.push(
      { id: `${row.id}-rename`, label: label.rename, icon: icon(<Pencil size={14} aria-hidden="true" />), onSelect: () => runAction(row.onEdit) },
    )
    if (row.colorEditable !== false) {
      items.push({ id: `${row.id}-color`, label: label.color, icon: icon(<Palette size={14} aria-hidden="true" />), onSelect: () => runAction(row.onEdit) })
    }
  }
  if (row.onMoveUp) {
    items.push({ id: `${row.id}-up`, label: label.up, icon: icon(<ArrowUp size={14} aria-hidden="true" />), onSelect: () => runAction(row.onMoveUp) })
  }
  if (row.onMoveDown) {
    items.push({ id: `${row.id}-down`, label: label.down, icon: icon(<ArrowDown size={14} aria-hidden="true" />), onSelect: () => runAction(row.onMoveDown) })
  }
  if (row.onDelete) {
    items.push({
      id: `${row.id}-delete`,
      label: label.remove,
      icon: icon(<Trash2 size={14} aria-hidden="true" />),
      tone: 'danger',
      dividerBefore: items.length > 0,
      onSelect: () => runAction(row.onDelete),
    })
  }
  return items
}

export default function FolderPanel({
  rows,
  activeId,
  onSelect,
  total,
  heading = 'フォルダ',
  onAddFolder,
  addFolderLabel = 'フォルダを追加する',
  addFolderDisabled = false,
  addFolderTitle,
  addFolderNote,
  children,
  createAction,
  reserveCreateSpace = false,
}: {
  /** V8: 作る操作はフォルダ列の先頭に置く。 */
  createAction?: ReactNode
  /** 閲覧のみで作る操作を隠すときも、フォルダの位置は変えない。V8 のみ。 */
  reserveCreateSpace?: boolean
  rows: FolderPanelRow[]
  activeId: string
  onSelect: (id: string) => void
  /*
   * 見出しの右に出す総数。単位は画面ごとに違うので文字で受ける。
   * 「すべて」の行が同じ数を出すので、重ねて出さない画面では渡さない
   * （1画面に同じ数を何度も書かない）。渡さないときは見出しだけ出す。
   */
  total?: string
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
  const v8 = useAdminTheme() === 'v8'
  const runAction = (action: (() => void) | undefined) => {
    setOpenMenuId(null)
    action?.()
  }

  return (
    // **読み上げ名を持つ。** 帯が何の分類かを、見出しの外からも辿れるように。
    <aside aria-label="フォルダ" className={`${styles.panel} v7:bg-canvas v7:rounded-card v7:border-hairline v7:h-fit overflow-visible v7:border`}>
      {createAction ? <div className={`${styles.create} v8-only`}>{createAction}</div> : reserveCreateSpace ? <div className={`${styles.create} ${styles.createPlaceholder} v8-only`} aria-hidden="true" /> : null}
      <div className={`${styles.heading} v7:border-hairline flex items-center justify-between v7:border-b v7:px-4 v7:py-3`}>
        <p className="v7:text-ink v7:text-sm font-semibold">{heading}</p>
        {total === undefined ? null : <span className="text-ink-faint v7:text-xs v7:tabular-nums">{total}</span>}
      </div>
      <nav className={`${styles.rows} v7:p-2`}>
        {rows.map((row) => {
          const hasActions = Boolean(row.onEdit || row.onMoveUp || row.onMoveDown || row.onDelete)
          const isActive = activeId === row.id

          return (
            <div
              key={row.id}
              className={`${styles.row} group relative flex items-center`}
              data-active={isActive || undefined}
              data-menu-open={openMenuId === row.id || undefined}
              data-has-actions={hasActions || undefined}
            >
              <button
                type="button"
                onClick={() => {
                  setOpenMenuId(null)
                  onSelect(row.id)
                }}
                title={row.label}
                aria-current={activeId === row.id ? 'true' : undefined}
                className={`${styles.select} v7:rounded-control flex min-w-0 flex-1 items-center gap-2 v7:px-3 v7:py-2 text-left v7:text-sm transition-colors ${
                  activeId === row.id
                    ? 'v7:bg-accent-soft v7:text-accent-deep v7:font-medium'
                    : 'v7:text-ink-secondary hover:bg-canvas-sunken'
                }`}
              >
                {/* 色が付いているフォルダは丸で出す。フォルダの形を塗ると、
                    色が面で乗って名前より目立ってしまう。 */}
                {row.color ? (
                  <span
                    className="v7-only rounded-pill h-3 w-3 shrink-0"
                    style={{ backgroundColor: row.color }}
                    aria-hidden="true"
                  />
                ) : (
                  <svg
                    className="v7-only h-4 w-4 shrink-0"
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
                <span className={`${styles.folderIcon} v8-only`} aria-hidden="true">{row.icon ?? (row.color ? <svg width="15" height="15" viewBox="0 0 14 14"><path fill={row.color} d="M11.8125 3.9375H7.16406L5.6875 2.46094Q5.41406 2.1875 5.08594 2.1875H2.1875Q1.80469 2.1875 1.55859 2.43359T1.3125 3.0625V10.99219Q1.3125 11.32031 1.55859 11.56641T2.13281 11.8125H11.86719Q12.19531 11.8125 12.44141 11.56641T12.6875 10.99219V4.8125Q12.6875 4.42969 12.44141 4.18359T11.8125 3.9375ZM2.1875 3.0625H5.08594L5.96094 3.9375H2.1875Z" /></svg> : <FolderOpen size={15} />)}</span>
                <span className={`${styles.label} min-w-0 flex-1 truncate`}>{row.label}</span>
                {row.count === null ? null : <span className={`${styles.count} text-ink-faint shrink-0 v7:text-xs v7:tabular-nums`}>{row.count}</span>}
              </button>
              {/* 操作は設計どおり1つの「…」へまとめる。行に5個の小さな口を
                  並べると、選択との押し間違いが増え、短い名前も狭くなる。 */}
              {/* I3L41O：選んだ行には絵どおり「…」の場所を取る。操作なしの
                  選んだ行（すべて・未分類）は空きの場所取りを置く。 */}
              {isActive && !hasActions ? (
                <div className={styles.menuSlot} aria-hidden="true" />
              ) : null}
              {hasActions && (
                <div className={`${styles.menu} v7:relative shrink-0`}>
                  <button
                    type="button"
                    data-qa-open={row.qaOpen}
                    onClick={() => setOpenMenuId((current) => (current === row.id ? null : row.id))}
                    aria-label={`フォルダ「${row.label}」の操作`}
                    aria-haspopup="menu"
                    aria-expanded={openMenuId === row.id}
                    title={`フォルダ「${row.label}」の操作`}
                    // R37: 狭い幅ではホバーが無いため「…」を常に出す。
                    // 出さないとスマホから名前変更・削除に届かない。
                    className={`${styles.menuButton} text-ink-faint v7:hover:bg-canvas-sunken hover:text-action v7:rounded-control min-h-8 min-w-8 text-lg leading-none v7:opacity-0 transition-opacity v7:group-hover:opacity-100 v7:focus:opacity-100 v7:max-lg:opacity-100`}
                  >
                    <span className="v7-only">…</span><Ellipsis className="v8-only" size={14} aria-hidden="true" />
                  </button>
                  {/*
                    ★V7（m13g）：フォルダの操作も共通 ActionMenu にそろえる。
                    できること（名前・色・並び順・削除・消す前の注意）は変えない。
                  */}
                  <ActionMenu
                    open={openMenuId === row.id}
                    onClose={() => setOpenMenuId(null)}
                    ariaLabel={`フォルダ「${row.label}」の操作`}
                    note={v8 ? undefined : row.deleteNote}
                    items={folderMenuItems(row, runAction, v8)}
                  />
                </div>
              )}
            </div>
          )
        })}
      </nav>
      {(onAddFolder || addFolderDisabled || addFolderNote || children) && (
        <div className={`${styles.footer} v7:border-hairline v7:space-y-2 v7:border-t v7:p-3`}>
          {(onAddFolder || addFolderDisabled) && (
            <Button
              type="button"
              onClick={onAddFolder}
              disabled={addFolderDisabled}
              title={addFolderTitle}
              className={`${styles.add} v7:w-full`}
            >
              <FolderPlus className="v8-only" size={14} aria-hidden="true" />
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
