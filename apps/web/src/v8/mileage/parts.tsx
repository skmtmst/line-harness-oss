'use client'

/*
 * マイルの各タブで同じ形の部品（道具の段・よく使う絞り込み・件数・空と失敗の1枚）。
 * 形は一覧の型と共通部品に任せ、ここは並べ方だけを持つ。
 */
import type { ReactNode } from 'react'
import { Bookmark } from 'lucide-react'
import ListState from '@/components/shared/list-state'
import Button from '@/components/shared/button'
import ListToolbar from '@/components/shared/list-toolbar'
import Notice from '@/components/shared/notice'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import styles from './mileage.module.css'

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
  error,
  success,
  warn,
}: {
  info?: ReactNode
  error?: string
  success?: string
  warn?: string
}) {
  return (
    <>
      {info ? <div className={styles.fullRow}><Notice tone="info">{info}</Notice></div> : null}
      {error ? <div className={styles.fullRow}><Notice tone="danger" message={error} /></div> : null}
      {success ? <div className={styles.fullRow}><Notice tone="success" message={success} /></div> : null}
      {warn ? <div className={styles.fullRow}><Notice tone="warn" message={warn} /></div> : null}
    </>
  )
}

export interface MileageToolbarProps {
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
export function MileageToolbar({ narrow, notices, search, chips, trailing, narrowLead }: MileageToolbarProps) {
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

/** 空・絞り込みで0件・失敗の1枚（見本帳 zaqP9）。 */
export function StateCard({
  tone = 'empty',
  title,
  description,
  action,
}: {
  tone?: 'empty' | 'error'
  title: string
  description?: string
  action?: ReactNode
}) {
  return <ListState kind={tone} title={title} description={description} action={action} />
}

/** 失敗の1枚の「もう一度試す」。 */
export function RetryButton({ onRetry }: { onRetry: () => void }) {
  return <Button type="button" onClick={onRetry}>もう一度試す</Button>
}
