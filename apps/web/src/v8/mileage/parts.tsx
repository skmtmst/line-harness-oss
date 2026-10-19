'use client'

/*
 * マイルの各タブで同じ形の部品（道具の段・よく使う絞り込み・件数・空と失敗の1枚）。
 * 形は一覧の型と共通部品に任せ、ここは並べ方だけを持つ。
 */
import type { ReactNode } from 'react'
import { Bookmark } from 'lucide-react'
import ListState from '@/components/shared/list-state'
import Button from '@/components/shared/button'
import ListToolbar, { ListToolbarFrame, ListToolbarOptional } from '@/components/shared/list-toolbar'
import Notice from '@/components/shared/notice'
import type { StatusBadgeTone } from '@/components/shared/status-badge'
import Select from '@/components/shared/select'
import styles from './mileage.module.css'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import { PAGE_SIZE_SELECT_OPTIONS } from '@/components/shared/page-size-select'

export const PAGE_SIZE_OPTIONS = PAGE_SIZE_SELECT_OPTIONS

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
    <ListToolbarOptional label="保存した絞り込み">
      <SaveErrorField names={["value"]}><Select size="content" icon={<Bookmark size={15} aria-hidden="true" />} aria-label="よく使う絞り込み" value={value} options={options} onChange={onChange} /></SaveErrorField>
    </ListToolbarOptional>
  )
}

/** 道具の段の右端：1ページに出す件数（10・20・50）。 */
export function PerPageSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div data-per-page-select>
      <SaveErrorField names={["value"]}><Select
        aria-label="1ページに出す件数"
        size="page-size"
        value={String(value)}
        onChange={(next) => onChange(Number(next))}
        options={PAGE_SIZE_OPTIONS}
      /></SaveErrorField>
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
export function MileageToolbar({ notices, search, chips, trailing }: MileageToolbarProps) {
  return <ListToolbarFrame>
    {notices}
    <ListToolbar search={{ ...search, width: 240 }} filters={chips} trailing={trailing} />
  </ListToolbarFrame>
}

export function mileageStatusTone(tone: 'active' | 'warn' | 'danger' | 'neutral'): StatusBadgeTone {
  return tone === 'active' ? 'success' : tone === 'warn' ? 'warning' : tone
}

/** 空・絞り込みで0件・失敗の1枚（見本帳 ）。 */
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
  return <Button type="button" onClick={onRetry}>もう一度読み込む</Button>
}
