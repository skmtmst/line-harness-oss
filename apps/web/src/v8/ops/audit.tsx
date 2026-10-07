'use client'

import { CircleDot, Download, Star } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, type OpsAuditRow } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { AUDIT_ACTION_LABEL, formatDateTime, opsCall } from '@/components/ops/ops-ui'
import { opsEnvironmentLabel } from '@/components/ops/ops-env-bar'
import Button from '@/components/shared/button'
import DateField from '@/components/shared/date-field'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import { OpsHead } from './shell'
import parts from './parts.module.css'
import styles from './audit.module.css'

/**
 * 運営の監査ログ V8（絵 `e7ljE`）。
 *
 * 動きは v7（app/ops/audit）と同じ口：種類（代理ログイン・個人情報の表示・
 * 契約先の停止・運営メンバー）と期間で /api/ops/audit を読み、50件ずつ送る。
 * CSV はいまの条件で全部（上限 2万件）を書き出す。記録は消せない。
 */

const FILTERS: Array<{ key: string; label: string; actions: string }> = [
  { key: 'impersonation', label: '代理ログイン', actions: 'impersonation.start,impersonation.write,impersonation.end' },
  { key: 'pii', label: '個人情報の表示', actions: 'pii.reveal' },
  { key: 'status', label: '契約先の停止', actions: 'tenant.status.change' },
  { key: 'members', label: '運営メンバー', actions: 'member.invite,member.deactivate,member.activate' },
]

const PAGE = 50
const CSV_PAGE = 500
const CSV_MAX = 20_000

const ACTION_WORD: Record<string, string> = {
  'impersonation.start': '代理ログイン（閲覧）',
  'impersonation.write': '代理ログイン（書き込み）',
  'tenant.status.change': '契約先の停止',
  'pii.reveal': '個人情報の表示',
  'member.invite': '運営メンバー',
  'member.deactivate': '運営メンバー',
  'member.activate': '運営メンバー',
}

function actionWord(action: string): string {
  return ACTION_WORD[action] ?? AUDIT_ACTION_LABEL[action]?.label ?? action
}

/** 短い日時（10/1 15:20 の形）。 */
function shortDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const full = formatDateTime(value)
  const m = full.match(/^(\d+)-(\d+)-(\d+) (\d+:\d+)$/)
  if (!m) return full
  return `${Number(m[2])}/${Number(m[3])} ${m[4]}`
}

export default function OpsAuditV8() {
  const [rows, setRows] = useState<OpsAuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState('')

  const actionsFor = (key: string) => FILTERS.find((f) => f.key === key)?.actions || undefined

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const res = await opsCall(api.ops.audit({ action: actionsFor(filter), from: from || undefined, to: to ? `${to}T23:59:59` : undefined, limit: PAGE, offset: (page - 1) * PAGE }))
    setLoading(false)
    if (!res.success) { setError(res.error || '読み込めませんでした'); return }
    setRows(res.data)
    setTotal(res.total)
  }, [filter, from, to, page])

  useEffect(() => { void load() }, [load])

  const exportCsv = async () => {
    setExporting(true)
    setExportNote('')
    const collected: OpsAuditRow[] = []
    let expected = 0
    let truncated = false
    for (let offset = 0; ; offset += CSV_PAGE) {
      const res = await opsCall(api.ops.audit({ action: actionsFor(filter), from: from || undefined, to: to ? `${to}T23:59:59` : undefined, limit: CSV_PAGE, offset }))
      if (!res.success) { setError(res.error || '書き出せませんでした'); setExporting(false); return }
      collected.push(...res.data)
      expected = res.total
      if (res.data.length < CSV_PAGE || collected.length >= res.total) break
      if (collected.length >= CSV_MAX) { truncated = true; break }
    }
    const header = ['日時', '運営者', '契約先', '操作', '理由', 'IP', '契約先に表示']
    const lines = collected.map((r) => [
      r.created_at, r.staff_name, r.tenant_name ?? '', AUDIT_ACTION_LABEL[r.action]?.label ?? r.action, r.reason ?? '', r.ip ?? '', r.visible_to_tenant ? '表示' : '運営のみ',
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const blob = new Blob([`﻿${[header.join(','), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `musubo-audit-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setExportNote(truncated
      ? `いまの条件の ${collected.length} 件を書き出しました（${expected} 件中・上限 ${formatNumber(CSV_MAX)} 件まで。全部を残すには期間で絞ってください）`
      : `いまの条件の ${collected.length} 件を書き出しました`)
    setExporting(false)
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE))

  return (
    <div data-design-node="e7ljE">
      <OpsHead
        title="監査ログ"
        description="運営が行った操作の記録です。代理ログイン・個人情報の表示・契約先の停止・運営メンバーの変更が残ります。"
        environment={opsEnvironmentLabel(process.env.NEXT_PUBLIC_API_URL)}
        actions={(
          <Button onClick={() => void exportCsv()} disabled={exporting || total === 0} busy={exporting} busyLabel="書き出しています…">
            <Download aria-hidden="true" />CSV で書き出す
          </Button>
        )}
      />
      <div className={parts.stack}>
        <div className={styles.tools}>
          <FilterChip icon={<CircleDot size={13} aria-hidden="true" />} selected={filter === ''} onChange={() => { setFilter(''); setPage(1) }}>すべて</FilterChip>
          {FILTERS.map((f) => (
            <FilterChip key={f.key} icon={<Star size={13} aria-hidden="true" />} selected={filter === f.key} onChange={(selected) => { setFilter(selected ? f.key : ''); setPage(1) }}>
              {f.label}
            </FilterChip>
          ))}
          <span className={styles.spacer} />
          <span className={styles.dateLabel}>開始日</span>
          <div className={styles.date}>
            <DateField value={from} onChange={(value) => { setFrom(value); setPage(1) }} max={to || undefined} aria-label="開始日" />
          </div>
          <span className={styles.dateLabel}>終了日</span>
          <div className={styles.date}>
            <DateField value={to} onChange={(value) => { setTo(value); setPage(1) }} min={from || undefined} aria-label="終了日" />
          </div>
        </div>

        {exportNote ? <p role="status" className={parts.status}>{exportNote}</p> : null}
        {error && rows.length > 0 ? <p role="alert" className={parts.alert}>{error}</p> : null}

        {loading && rows.length === 0 ? (
          <ListState kind="loading" title="記録を読み込んでいます" />
        ) : error && rows.length === 0 ? (
          <div className={parts.panel}>
            <ListState kind="error" title="記録を表示できませんでした" description={error} onRetry={() => void load()} />
          </div>
        ) : rows.length === 0 ? (
          <div className={parts.panel}>
            <ListState kind="empty" title="記録がありません" description="運営が操作を行うと、ここに残ります。" />
          </div>
        ) : (
          <div className={parts.mini} role="table" aria-label="監査ログ">
            <div className={parts.miniHead} role="row">
              <span className={`${parts.fixed} ${styles.colAt}`} role="columnheader">日時</span>
              <span className={`${parts.fixed} ${styles.colWho}`} role="columnheader">運営者</span>
              <span className={`${parts.fixed} ${styles.colWhat}`} role="columnheader">操作</span>
              <span className={`${parts.fixed} ${styles.colTenant}`} role="columnheader">契約先</span>
              <span className={parts.grow} role="columnheader">理由</span>
            </div>
            {rows.map((row) => (
              <div key={row.id} className={parts.miniRow} role="row">
                <span className={`${parts.fixed} ${styles.colAt}`} role="cell" title={formatDateTime(row.created_at)}>{shortDateTime(row.created_at)}</span>
                <span className={`${parts.fixed} ${styles.colWho}`} role="cell" title={row.staff_name}>{row.staff_name}</span>
                <span className={`${parts.fixed} ${styles.colWhat}`} role="cell">{actionWord(row.action)}</span>
                <span className={`${parts.fixed} ${styles.colTenant}`} role="cell" title={row.tenant_name ?? ''}>{row.tenant_name ?? '—'}</span>
                <span className={parts.grow} role="cell" title={row.reason ?? ''}>{row.reason ?? '—'}</span>
              </div>
            ))}
          </div>
        )}
        {pageCount > 1 ? (
          <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
        ) : null}
        <p className={parts.note}>記録は運営メンバーでも消せません。理由は4文字以上が必須です。</p>
      </div>
    </div>
  )
}
