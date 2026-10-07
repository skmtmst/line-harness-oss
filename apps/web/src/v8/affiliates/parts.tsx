'use client'

/*
 * 成果とアフィリエイトの各タブで同じ形の部品（道具の段・よく使う絞り込み・件数・
 * 状態の札・空と失敗の1枚・行の「…」）。形は一覧の型と共通部品に任せ、
 * ここは並べ方だけを持つ。
 */
import { useState, type ReactNode } from 'react'
import { Bookmark, MoreHorizontal, TriangleAlert } from 'lucide-react'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import ListToolbar from '@/components/shared/list-toolbar'
import Notice from '@/components/shared/notice'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import styles from './affiliates.module.css'

export const PAGE_SIZE_OPTIONS = [10, 20, 50].map((size) => ({ value: String(size), label: `${size}件表示` }))

/** 道具の段の右：「よく使う絞り込み」（左に印）。 */
export function SavedSelect({
  value,
  options,
  onChange,
}: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <div className={styles.savedBox}>
      <Bookmark size={15} aria-hidden="true" className={styles.savedIcon} />
      <Select aria-label="よく使う絞り込み" value={value} options={options} onChange={onChange} />
    </div>
  )
}

/** 道具の段の右端：1ページに出す件数（10・20・50）。 */
export function PerPageSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div data-per-page-select>
      <Select
        aria-label="1ページに出す件数"
        size="page-size"
        value={String(value)}
        onChange={(next) => onChange(Number(next))}
        options={PAGE_SIZE_OPTIONS}
      />
    </div>
  )
}

/** 道具の段の先頭に置く帯（案内・失敗・済んだ知らせ）。1行を取る。 */
export function ToolbarNotices({
  info,
  warn,
  error,
  success,
  children,
}: {
  info?: ReactNode
  warn?: ReactNode
  error?: string
  success?: string
  children?: ReactNode
}) {
  return (
    <>
      {info ? <div className={styles.fullRow}><Notice tone="info">{info}</Notice></div> : null}
      {warn ? <div className={styles.fullRow}><Notice tone="warn">{warn}</Notice></div> : null}
      {error ? <div className={styles.fullRow}><Notice tone="danger" message={error} /></div> : null}
      {success ? <div className={styles.fullRow}><Notice tone="success" message={success} /></div> : null}
      {children}
    </>
  )
}

export interface AffiliateToolbarProps {
  narrow: boolean
  notices: ReactNode
  search: { placeholder: string; value: string; onChange: (value: string) => void }
  /** 札（状態で絞り込む）。 */
  chips?: ReactNode
  /** 右：よく使う絞り込み・件数など。 */
  trailing?: ReactNode
  /** 1152 の板の1段目の頭（作るボタン・フォルダ選び）。 */
  narrowLead?: ReactNode
}

/**
 * 道具の段。広い板は型の道具（ListToolbar）を1段、1152 の板は
 * 「作る・フォルダ・探す」→「札 … 右の道具」の2段。部品は同じ。
 */
export function AffiliateToolbar({ narrow, notices, search, chips, trailing, narrowLead }: AffiliateToolbarProps) {
  if (narrow) {
    return (
      <div className={styles.narrowTools}>
        {notices}
        <div className={styles.narrowRow}>
          {narrowLead}
          <div className={styles.narrowSearch}>
            <SearchField
              aria-label={search.placeholder}
              placeholder={search.placeholder}
              value={search.value}
              onChange={search.onChange}
              onClear={() => search.onChange('')}
            />
          </div>
        </div>
        <div className={styles.narrowRow}>
          {chips}
          <span className={styles.spacer} aria-hidden="true" />
          {trailing}
        </div>
      </div>
    )
  }
  return (
    <>
      {notices}
      <ListToolbar
        search={{ placeholder: search.placeholder, value: search.value, width: 240, onChange: search.onChange }}
        filters={chips}
        trailing={trailing}
      />
    </>
  )
}

/** 状態の札（点つき）。tone は色の種類。 */
export function StatusPill({ tone, children }: { tone: 'active' | 'warn' | 'danger' | 'neutral'; children: ReactNode }) {
  return (
    <span className={styles.pill} data-tone={tone}>
      <span className={styles.pillDot} aria-hidden="true" />
      {children}
    </span>
  )
}

/** 空・絞り込みで0件・失敗の1枚（見本帳 rRk0C）。 */
export function StateCard({
  tone = 'empty',
  icon,
  title,
  description,
  action,
}: {
  tone?: 'empty' | 'error'
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className={styles.stateCard} role={tone === 'error' ? 'alert' : undefined}>
      {tone === 'error' ? (
        <span className={`${styles.stateIcon} ${styles.stateIconError}`}><TriangleAlert size={16} aria-hidden="true" /></span>
      ) : icon ? (
        <span className={styles.stateIcon}>{icon}</span>
      ) : null}
      <p className={styles.stateTitle}>{title}</p>
      {description ? <p className={styles.stateDesc}>{description}</p> : null}
      {action}
    </div>
  )
}

/** 失敗の1枚の「もう一度試す」。 */
export function RetryButton({ onRetry }: { onRetry: () => void }) {
  return <Button type="button" onClick={onRetry}>もう一度試す</Button>
}

/** 行の右端の「…」。メニューの目印が行を1段増やさないよう箱で包む。 */
export function RowMenu({ label, items }: { label: string; items: ActionMenuItem[] }) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null
  return (
    <span className={styles.menuBox}>
      <IconButton
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </IconButton>
      <ActionMenu open={open} ariaLabel={label} onClose={() => setOpen(false)} items={items} />
    </span>
  )
}
