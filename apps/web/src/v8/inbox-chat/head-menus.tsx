'use client'

/*
 * ★V8 会話の頭の「担当」「対応状況」（M0393 XqSvX の頭・段2「5. 会話の頭のメニュー」）。
 *
 * どちらも1つだけ選ぶもの。四角のチェックボックスは使わない（オーナー指摘：
 * 複数選べないのにチェックボックスに見える）。担当は 頭文字の丸＋名前、対応状況は
 * 状態の色の点つきの札。選んでいる行は地の色と ✓。担当は名前で探せる。
 * LINE の会話もメールの会話も、この同じ部品を使う。
 */
import { useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import MenuPortal from '@/components/shared/menu-portal'
import { buildOperatorRows, type OperatorOption } from '@/components/chats/inbox-dropdown'
import styles from './inbox-chat.module.css'

export type HeadStatus = 'unread' | 'in_progress' | 'on_hold' | 'resolved'

export const HEAD_STATUS_LABEL: Record<HeadStatus, string> = {
  unread: '未対応',
  in_progress: '対応中',
  on_hold: '保留',
  resolved: '対応済み',
}
const STATUS_ORDER: HeadStatus[] = ['unread', 'in_progress', 'on_hold', 'resolved']

export function HeadOperatorMenu({
  value,
  operators,
  onChange,
  ariaLabel = '担当者を変える',
}: {
  /** 担当者ID。未割り当ては 'unassigned' */
  value: string
  operators: OperatorOption[]
  onChange: (next: string) => void
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const rows = buildOperatorRows(operators, false, value)
  const q = query.trim().toLocaleLowerCase()
  const shown = q ? rows.filter((row) => row.name.toLocaleLowerCase().includes(q)) : rows
  const current = rows.find((row) => row.id === value)
  const close = () => { setOpen(false); setQuery('') }

  return (
    <div ref={wrapRef} className={styles.popWrap}>
      <button
        type="button"
        className={`${styles.ctl} ${styles.ctlOperator}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`担当：${current?.name ?? '未割り当て'}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        担当：{current?.name ?? '未割り当て'}
        <ChevronDown aria-hidden="true" />
      </button>
      <MenuPortal open={open} align="end" getAnchor={() => wrapRef.current} onClose={close}>
        <div className={styles.menu}>
          <p className={styles.menuTitle}>担当者を変える</p>
          <label className={styles.menuSearch}>
            <Search aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="担当者名を検索"
              aria-label="担当者名を検索"
              className={styles.menuSearchInput}
            />
          </label>
          <div role="listbox" aria-label={ariaLabel}>
            {shown.length === 0 ? <p className={styles.menuEmpty}>見つかりません</p> : shown.map((row) => {
              const selected = row.id === value
              const mark = row.id === 'unassigned' ? '－' : Array.from(row.name.trim())[0] ?? '—'
              return (
                <button
                  key={row.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={styles.menuRow}
                  onClick={() => { onChange(row.id); close() }}
                >
                  <span aria-hidden="true" className={styles.menuFace}>{mark}</span>
                  <span className={styles.menuName}>{row.name}</span>
                  {selected ? <Check aria-hidden="true" className={styles.menuCheck} /> : null}
                </button>
              )
            })}
          </div>
        </div>
      </MenuPortal>
    </div>
  )
}

export function HeadStatusMenu({
  value,
  onChange,
  ariaLabel = '対応状況を変える',
}: {
  value: HeadStatus
  onChange: (next: HeadStatus) => void
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const label = HEAD_STATUS_LABEL[value] ?? '未対応'

  return (
    <div ref={wrapRef} className={styles.popWrap}>
      <button
        type="button"
        className={styles.ctl}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
      >
        <span aria-hidden="true" className={`${styles.ctlDot} ${styles[`dot_${value}`] ?? ''}`} />
        {label}
        <ChevronDown aria-hidden="true" />
      </button>
      <MenuPortal open={open} align="end" getAnchor={() => wrapRef.current} onClose={() => setOpen(false)}>
        <div className={styles.menu}>
          <p className={styles.menuTitle}>対応状況を変える</p>
          <div role="listbox" aria-label={ariaLabel}>
            {STATUS_ORDER.map((status) => {
              const selected = status === value
              return (
                <button
                  key={status}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={styles.menuRow}
                  onClick={() => { onChange(status); setOpen(false) }}
                >
                  <span className={`${styles.pill} ${styles[`st_${status}`]}`}>
                    <span aria-hidden="true" className={styles.pillDot} />
                    {HEAD_STATUS_LABEL[status]}
                  </span>
                  {selected ? <Check aria-hidden="true" className={styles.menuCheck} /> : null}
                </button>
              )
            })}
          </div>
        </div>
      </MenuPortal>
    </div>
  )
}
