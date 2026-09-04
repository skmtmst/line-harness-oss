'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * 受信箱のプルダウン。
 *
 * **共通の `Select` は使えない。** 設計（Pencil `lJ1CF` 担当者プルダウン
 * 開状態、`k6lHgo` ヘッダー対応状況プルダウン開状態）は、共通部品
 * （`Gfsb4`）と作りが違う。
 *
 * - 担当者 … 選択肢の上に**名前で絞る入力欄**がある。担当が増えるほど
 *   縦に伸びるので、探す手段が要る
 * - 対応状況 … 1件ずつに**色の丸と色付きの札**が付く。未対応が赤、
 *   対応中が黄、対応済みが緑。文字だけだと、一覧の札と目で結びつかない
 *
 * 素の `<select>` にしていたころは、開いた中身がブラウザ任せで
 * **画像に写らなかった**。設計の 2-8 / 2-9 / 2-10 は「開いた状態」なので、
 * 素のセレクトのままでは永久に見比べられない。
 */

/** 外側を押したら閉じる。開いたまま別の操作へ移ると、どれが開いているのか分からなくなる。 */
function useCloseOnOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      className={open ? 'rotate-180' : undefined}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

const panelClass = 'border-hairline rounded-control bg-canvas absolute z-30 mt-1 min-w-full overflow-hidden border shadow-lg'
const rowClass = 'flex w-full items-center gap-2 px-3 py-2 text-left text-xs'

// ─────────────────────────────────────────────────────────────
// 担当者
// ─────────────────────────────────────────────────────────────

export type OperatorOption = { id: string; name: string }

export function buildOperatorRows(operators: OperatorOption[], allowAll: boolean): OperatorOption[] {
  return [
    ...(allowAll ? [{ id: 'all', name: 'すべて' }] : []),
    { id: 'unassigned', name: '未割り当て' },
    ...operators,
  ]
}

export function OperatorDropdown({
  value,
  operators,
  onChange,
  label = '担当者',
  ariaLabel = '担当者を選ぶ',
  allowAll = true,
  unreadOf,
}: {
  /** `all` すべて / `unassigned` 未割り当て / それ以外は担当者ID */
  value: string
  operators: OperatorOption[]
  onChange: (next: string) => void
  label?: string
  ariaLabel?: string
  /** 一覧の絞り込みでは true。担当者を変更するときは「すべて」を選べないので false。 */
  allowAll?: boolean
  /**
   * 行に添える未読数。**渡さなければ数を出さない**（担当を変える口など、
   * 未読数が要らない場面で使うため）。
   * `null` を返したら**未取得**で、`—` を出す。**0とは別。**
   */
  unreadOf?: (value: string) => number | null
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useCloseOnOutside(open, () => setOpen(false))

  const rows = buildOperatorRows(operators, allowAll)
  // 名前で絞る。**大文字小文字を区別しない。** 「Kenta」と打っても出る。
  const shown = query.trim()
    ? rows.filter((row) => row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    : rows
  const current = rows.find((row) => row.id === value)

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
        className={`border-hairline rounded-control bg-canvas text-ink flex w-full items-center gap-1.5 border px-2.5 py-1.5 text-xs ${open ? 'border-accent' : ''}`}
      >
        <span className="text-ink-faint">{label}：</span>
        <span className="truncate font-medium">{current?.name ?? (allowAll ? 'すべて' : '未割り当て')}</span>
        <span className="text-ink-faint ml-auto"><Chevron open={open} /></span>
      </button>
      {open ? (
        <div className={panelClass} role="listbox" aria-label={ariaLabel}>
          {/* 担当が増えるほど縦に伸びる。探す手段が無いと使えない。 */}
          <div className="border-hairline border-b p-2">
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="担当者名を検索"
              aria-label="担当者名を検索"
              className="border-hairline rounded-control text-ink placeholder:text-ink-faint w-full border px-2 py-1 text-xs outline-none"
            />
          </div>
          {shown.length === 0 ? (
            <p className="text-ink-faint px-3 py-3 text-xs">見つかりません</p>
          ) : shown.map((row) => {
            const selected = row.id === value
            /*
              **「すべて」には数を付けない**（担当者ではないため）。
              未取得は `—`。0と同じ文字にすると、**誰にも未読が無いのか
              読めていないのかが見分けられなくなる。**
            */
            const unread = unreadOf && row.id !== 'all' ? unreadOf(row.id) : undefined
            return (
              <button
                key={row.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => { onChange(row.id); setOpen(false); setQuery('') }}
                className={`${rowClass} ${selected ? 'bg-accent-soft text-accent font-medium' : 'text-ink hover:bg-canvas-sunken'}`}
              >
                <span className={selected ? 'text-accent' : 'text-ink-faint'}>
                  {selected ? <Check /> : <span className="block h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-left">{row.name}</span>
                {unread === undefined ? null : (
                  <span className={`shrink-0 tabular-nums ${selected ? 'text-accent' : 'text-ink-faint'}`}>
                    {unread === null ? '—' : unread}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 対応状況
// ─────────────────────────────────────────────────────────────

export type ChatStatus = 'unread' | 'in_progress' | 'on_hold' | 'resolved'

/**
 * 状態ごとの色。**一覧の札と同じ色を使う。**
 * ここだけ別の色にすると、開いて選んだものと一覧に出るものが結びつかない。
 */
const STATUS_STYLE: Record<ChatStatus, { label: string; dot: string; pill: string }> = {
  unread: { label: '未対応', dot: 'bg-danger', pill: 'bg-danger-bg text-danger' },
  in_progress: { label: '対応中', dot: 'bg-warning', pill: 'bg-warning-bg text-warning' },
  on_hold: { label: '保留', dot: 'bg-info', pill: 'bg-info-bg text-info' },
  resolved: { label: '対応済み', dot: 'bg-accent', pill: 'bg-accent-soft text-accent' },
}

const STATUS_ORDER: ChatStatus[] = ['unread', 'in_progress', 'on_hold', 'resolved']

export function StatusDropdown({
  value,
  onChange,
  ariaLabel = '対応状況を変える',
}: {
  value: ChatStatus
  onChange: (next: ChatStatus) => void
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useCloseOnOutside(open, () => setOpen(false))
  const current = STATUS_STYLE[value]

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
        className={`border-hairline rounded-control bg-canvas flex items-center gap-1.5 border px-2.5 py-1.5 text-xs ${open ? 'border-accent' : ''}`}
      >
        <span className={`h-2 w-2 rounded-full ${current.dot}`} aria-hidden="true" />
        <span className="font-medium">{current.label}</span>
        <span className="text-ink-faint"><Chevron open={open} /></span>
      </button>
      {open ? (
        <div className={`${panelClass} right-0`} role="listbox" aria-label={ariaLabel}>
          {STATUS_ORDER.map((status) => {
            const style = STATUS_STYLE[status]
            const selected = status === value
            return (
              <button
                key={status}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => { onChange(status); setOpen(false) }}
                className={`${rowClass} whitespace-nowrap ${selected ? 'bg-canvas-sunken' : 'hover:bg-canvas-sunken'}`}
              >
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
                <span className={`rounded-pill px-2 py-0.5 text-[11px] font-medium ${style.pill}`}>{style.label}</span>
                <span className={`text-accent ml-auto ${selected ? '' : 'invisible'}`}><Check /></span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// テンプレートの置き場
// ─────────────────────────────────────────────────────────────

export type FolderOption = { id: string; name: string; count: number }

/**
 * テンプレートの置き場を選ぶ（設計 Pencil `esGzX` すべてのフォルダ・ドロップダウン）。
 *
 * 素の `<select>` にしていたころは、**開いた中身が画像に写らなかった**。
 * 設計の 2-6（全フォルダ展開）と 2-11（予約フォルダ）は「開いた状態」なので、
 * 素のセレクトのままでは見比べられない。
 *
 * 中身は 検索欄 ＋「すべてのフォルダ」＋ 置き場ごとの件数。
 * **件数を出す。** ひな形が20枚あるとき、どこに何枚あるかが分からないと
 * 「予約」を開くべきかどうかが決められない。
 */
export function FolderDropdown({
  value,
  folders,
  totalCount,
  onChange,
  ariaLabel = 'フォルダ',
}: {
  /** 空文字はすべてのフォルダ */
  value: string
  folders: FolderOption[]
  totalCount: number
  onChange: (next: string) => void
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useCloseOnOutside(open, () => setOpen(false))

  const shown = query.trim()
    ? folders.filter((folder) => folder.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    : folders
  const current = folders.find((folder) => folder.id === value)

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
        className={`border-hairline rounded-control bg-canvas text-ink flex w-full items-center gap-2 border px-3 py-2.5 text-sm font-medium ${open ? 'border-accent' : ''}`}
      >
        <span className="truncate">
          {current ? `${current.name}（${current.count}）` : `すべてのフォルダ（${totalCount}）`}
        </span>
        <span className="text-ink-faint ml-auto"><Chevron open={open} /></span>
      </button>
      {open ? (
        <div className={`${panelClass} right-0 w-70`} role="listbox" aria-label={ariaLabel}>
          <div className="border-hairline border-b p-2">
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="フォルダを検索"
              aria-label="フォルダを検索"
              className="border-hairline rounded-control text-ink placeholder:text-ink-faint w-full border px-2 py-1.5 text-xs outline-none"
            />
          </div>
          <button
            type="button"
            role="option"
            aria-selected={value === ''}
            onClick={() => { onChange(''); setOpen(false); setQuery('') }}
            className={`${rowClass} justify-between ${value === '' ? 'bg-accent-soft text-accent font-medium' : 'text-ink hover:bg-canvas-sunken'}`}
          >
            <span className="truncate">すべてのフォルダ</span>
            <span className="tabular-nums">{totalCount}</span>
          </button>
          {shown.map((folder) => {
            const selected = folder.id === value
            return (
              <button
                key={folder.id}
                type="button"
                role="option"
                // 分類のチップにも同じ名前（「予約」など）が出る。
                // どちらを指しているか読み上げでも試験でも分かるようにする。
                aria-label={`フォルダ ${folder.name}`}
                aria-selected={selected}
                onClick={() => { onChange(folder.id); setOpen(false); setQuery('') }}
                className={`${rowClass} justify-between ${selected ? 'bg-accent-soft text-accent font-medium' : 'text-ink hover:bg-canvas-sunken'}`}
              >
                <span className="truncate">{folder.name}</span>
                <span className="text-ink-faint tabular-nums">{folder.count}</span>
              </button>
            )
          })}
          {shown.length === 0 ? <p className="text-ink-faint px-3 py-3 text-xs">見つかりません</p> : null}
        </div>
      ) : null}
    </div>
  )
}
