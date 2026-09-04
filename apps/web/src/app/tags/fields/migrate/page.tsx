'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { FriendField, FriendFieldType } from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Breadcrumb from '@/components/shared/breadcrumb'
import Button from '@/components/shared/button'
import StickyBar from '@/components/shared/sticky-bar'
import SelectField from '@/components/shared/select-field'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { ApiError, api } from '@/lib/api'
import { FIELD_TYPE_HINTS, FIELD_TYPE_LABELS } from '@/components/friend-fields/field-list'

const TYPES = Object.keys(FIELD_TYPE_LABELS) as FriendFieldType[]

type Preview = {
  summary: { total: number; convertible: number; review: number; invalid: number }
  rows: Array<{
    friendId: string
    sourceValue: string
    convertedValue: string | null
    status: 'review' | 'invalid'
    reason: string | null
  }>
}

function FieldSummary({ title, field, kind }: { title: string; field: FriendField; kind: 'source' | 'target' }) {
  return (
    <section className="rounded-card border border-hairline bg-canvas p-5 shadow-sm">
      <p className="text-xs font-semibold text-ink-faint">{title}</p>
      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-ink">{field.name}</h2>
          <p className="mt-1 font-mono text-xs text-ink-faint">{`{{field.${field.fieldKey}}}`}</p>
        </div>
        <span className={kind === 'source' ? 'rounded-full bg-surface-soft px-3 py-1 text-xs font-semibold text-ink-secondary' : 'rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent'}>
          {FIELD_TYPE_LABELS[field.type]}
        </span>
      </div>
    </section>
  )
}

function MigrateFriendField() {
  usePageTitle('友だち情報欄を移行')
  const params = useSearchParams()
  const sourceId = params.get('id') ?? ''
  const { selectedAccountId } = useAccount()
  const [fields, setFields] = useState<FriendField[]>([])
  const [targetName, setTargetName] = useState('')
  const [targetType, setTargetType] = useState<FriendFieldType>('text')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!selectedAccountId) {
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    void api.friendFields.list(selectedAccountId, { withUsage: true })
      .then((res) => {
        if (!active) return
        if (!res.success) throw new Error(res.error)
        setFields(res.data)
        const source = res.data.find((item) => item.id === sourceId)
        if (source) {
          setTargetName(`${source.name}（新）`)
          setTargetType(source.type)
        }
      })
      .catch((reason) => { if (active) setError(reason instanceof ApiError ? reason.message : '項目を読み込めませんでした') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [selectedAccountId, sourceId])

  const source = useMemo(() => fields.find((item) => item.id === sourceId) ?? null, [fields, sourceId])
  const target = source ? { ...source, name: targetName || `${source.name}（新）`, fieldKey: `${source.fieldKey}_new`.slice(0, 32), type: targetType } : null

  const runPreview = async () => {
    if (!source || !selectedAccountId || checking) return
    setChecking(true); setError(''); setPreview(null)
    try {
      const res = await api.friendFields.migrationPreview(source.id, selectedAccountId, targetType)
      if (!res.success) throw new Error(res.error)
      setPreview({ summary: res.data.summary, rows: res.data.rows })
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '事前確認を実行できませんでした')
    } finally { setChecking(false) }
  }

  if (loading) return <div data-design-node="KoT6c" className="p-6 text-sm text-ink-faint">友だち情報欄を読み込んでいます…</div>
  if (!selectedAccountId) return <div data-design-node="KoT6c" role="alert" className="rounded-control border border-warning/30 bg-warning-bg p-4 text-sm text-warning">LINE公式アカウントを選んでください。</div>
  if (!source || !target) return <div data-design-node="KoT6c" role="alert" className="rounded-control border border-danger/20 bg-danger-bg p-4 text-sm text-danger">移行元の項目が見つかりません。友だち情報欄の一覧から選び直してください。</div>

  return (
    <div data-design-node="KoT6c">
      <div className="mb-4 flex items-center justify-between gap-4">
        <Breadcrumb items={[{ label: '友だち情報欄', href: '/tags?tab=fields' }, { label: '項目を移行' }]} />
        <Button href="/tags?tab=fields">友だち情報欄へ</Button>
      </div>

      <div className="mb-4 rounded-control border border-info/25 bg-info-bg p-4 text-sm leading-6 text-info">
        まず事前確認だけを行います。友だちの値や既存の項目は変更しません。確認が必要な値を直してから、移行を実行してください。
      </div>
      {error ? <p role="alert" className="mb-4 rounded-control border border-danger/20 bg-danger-bg p-3 text-sm text-danger">{error}</p> : null}

      <div data-design="Fields" className="grid gap-4 xl:grid-cols-3 xl:items-stretch">
        <FieldSummary title="いま使っている項目" field={source} kind="source" />
        <div className="flex items-center justify-center text-2xl text-ink-faint" aria-hidden="true">→</div>
        <section className="rounded-card border border-accent/30 bg-canvas p-5 shadow-sm">
          <p className="text-xs font-semibold text-accent">新しく作る項目</p>
          <label className="mt-3 block text-sm font-semibold text-ink">項目名
            <input value={targetName} onChange={(event) => { setTargetName(event.target.value); setPreview(null) }} className="mt-1.5 h-10 w-full rounded-control border border-hairline bg-canvas px-3 font-normal outline-none focus:border-accent" />
          </label>
          <label className="mt-3 block text-sm font-semibold text-ink">種類
            <SelectField
              value={targetType}
              onChange={(event) => { setTargetType(event.target.value as FriendFieldType); setPreview(null) }}
              aria-label="移行後の友だち情報欄の種類"
              className="v6-select mt-1.5 h-10 w-full rounded-control border border-hairline bg-canvas px-3 font-normal"
              options={TYPES.map((type) => ({ value: type, label: `${FIELD_TYPE_LABELS[type]} — ${FIELD_TYPE_HINTS[type]}` }))}
            />
          </label>
        </section>
      </div>

      <section data-design="Preview" className="mt-4 rounded-card border border-hairline bg-canvas p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-base font-bold text-ink">値を変換できるか事前確認</h2><p className="mt-1 text-sm text-ink-secondary">登録済みの値を読み取り、移行できる数だけを確認します。</p></div>
          <Button type="button" onClick={() => void runPreview()} disabled={checking}>{checking ? '確認しています…' : '事前確認する'}</Button>
        </div>
        {preview ? (
          <div className="mt-5">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-control border border-hairline bg-surface-soft p-3"><p className="text-xs text-ink-faint">値がある友だち</p><p className="mt-1 text-xl font-bold text-ink">{preview.summary.total}人</p></div>
              <div className="rounded-control border border-hairline bg-surface-soft p-3"><p className="text-xs text-ink-faint">そのまま移せる</p><p className="mt-1 text-xl font-bold text-accent">{preview.summary.convertible}人</p></div>
              <div className="rounded-control border border-hairline bg-surface-soft p-3"><p className="text-xs text-ink-faint">人が確認する</p><p className="mt-1 text-xl font-bold text-warning">{preview.summary.review}人</p></div>
              <div className="rounded-control border border-hairline bg-surface-soft p-3"><p className="text-xs text-ink-faint">空欄</p><p className="mt-1 text-xl font-bold text-danger">{preview.summary.invalid}人</p></div>
            </div>
            {preview.rows.length ? (
              <DataTable className="mt-4">
                <thead><TableHeadRow><Th>友だちID</Th><Th>いまの値</Th><Th>確認する理由</Th></TableHeadRow></thead>
                <tbody>{preview.rows.map((row) => <Tr key={row.friendId}><Td className="truncate font-mono text-xs" title={row.friendId}>{row.friendId}</Td><Td className="truncate" title={row.sourceValue}>{row.sourceValue || '（空欄）'}</Td><Td>{row.reason ?? '確認してください'}</Td></Tr>)}</tbody>
              </DataTable>
            ) : <p className="mt-4 rounded-control bg-accent-soft p-3 text-sm text-accent">確認が必要な値はありません。</p>}
          </div>
        ) : <p className="mt-4 text-sm text-ink-faint">まだ事前確認していません。未取得を0人として表示しません。</p>}
      </section>

      <section data-design="Usage" className="mt-4 rounded-card border border-hairline bg-canvas p-5 shadow-sm">
        <h2 className="text-base font-bold text-ink">切り替わる使用先</h2>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <p className="rounded-control bg-surface-soft p-3">回答フォーム <strong className="float-right">—</strong></p>
          <p className="rounded-control bg-surface-soft p-3">友だち一覧・詳細 <strong className="float-right">確認中</strong></p>
          <p className="rounded-control bg-surface-soft p-3">差し込み・自動処理 <strong className="float-right">—</strong></p>
        </div>
        <p className="mt-2 text-xs text-ink-faint">使用先の全件集計は未接続です。取れていない数を0件とは表示しません。</p>
      </section>

      <StickyBar status={preview ? `事前確認済み：${preview.summary.total}人` : 'まだ事前確認していません'} actions={<><Button href="/tags?tab=fields">移行をやめる</Button><Button variant="primary" type="button" onClick={() => void runPreview()} disabled={checking}>{checking ? '確認しています…' : '事前確認する'}</Button></>} />
    </div>
  )
}

export default function MigrateFriendFieldPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-ink-faint">読み込み中…</div>}><MigrateFriendField /></Suspense>
}
