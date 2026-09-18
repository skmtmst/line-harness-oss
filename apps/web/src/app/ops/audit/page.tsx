'use client'

import { Download } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, type OpsAuditRow } from '@/lib/api'
import OpsPageHeader from '@/components/ops/ops-page-header'
import { AUDIT_ACTION_LABEL, auditActionChip, formatDateTime, opsCall } from '@/components/ops/ops-ui'
import Button from '@/components/shared/button'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'

/** 監査ログ。★V6 37-8 `oEzZz`。 */

const FILTERS: Array<{ key: string; label: string; actions: string }> = [
  { key: 'impersonation', label: '代理ログイン', actions: 'impersonation.start,impersonation.write,impersonation.end' },
  { key: 'pii', label: '個人情報の表示', actions: 'pii.reveal' },
  { key: 'status', label: '契約先の停止', actions: 'tenant.status.change' },
  { key: 'members', label: '運営メンバー', actions: 'member.invite,member.deactivate,member.activate' },
]

const PAGE = 50

export default function OpsAuditPage() {
  const [rows, setRows] = useState<OpsAuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const actions = FILTERS.find((f) => f.key === filter)?.actions || undefined
    const res = await opsCall(api.ops.audit({ action: actions, from: from || undefined, to: to ? `${to}T23:59:59` : undefined, limit: PAGE, offset: (page - 1) * PAGE }))
    setLoading(false)
    if (!res.success) { setError(res.error || '読み込めませんでした'); return }
    setRows(res.data)
    setTotal(res.total)
  }, [filter, from, to, page])

  useEffect(() => { void load() }, [load])

  const exportCsv = () => {
    const header = ['日時', '運営者', '契約先', '操作', '理由', 'IP', '契約先に表示']
    const lines = rows.map((r) => [
      r.created_at, r.staff_name, r.tenant_name ?? '', AUDIT_ACTION_LABEL[r.action]?.label ?? r.action, r.reason ?? '', r.ip ?? '', r.visible_to_tenant ? '表示' : '運営のみ',
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const blob = new Blob([`﻿${[header.join(','), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `musubo-audit-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE))
  const first = total === 0 ? 0 : (page - 1) * PAGE + 1
  const last = Math.min(page * PAGE, total)

  return (
    <div data-design-node="oEzZz">
      <OpsPageHeader title="監査ログ" />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-lead font-bold text-ink">運営が行った操作の記録</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <FilterChip key={f.key} selected={filter === f.key} onChange={(selected) => { setFilter(selected ? f.key : ''); setPage(1) }}>
              {f.label}
            </FilterChip>
          ))}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-caption text-ink-secondary">
          <div className="w-40">
            <TextField type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} aria-label="開始日" />
          </div>
          〜
          <div className="w-40">
            <TextField type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} aria-label="終了日" />
          </div>
        </div>
        <Button onClick={exportCsv} disabled={rows.length === 0}>
          <Download aria-hidden="true" className="h-4 w-4" />
          CSVで書き出す
        </Button>
      </div>

      {error ? <p role="alert" className="mb-3 text-caption text-status-danger">{error}</p> : null}

      {loading ? (
        <ListState kind="loading" title="記録を読み込んでいます" />
      ) : rows.length === 0 ? (
        <ListState kind="empty" title="記録がありません" description="運営が操作を行うと、ここに残ります。" />
      ) : (
        <DataTable>
          <thead>
            <TableHeadRow>
              <Th className="w-40">日時</Th>
              <Th className="w-40">運営者</Th>
              <Th className="w-60">契約先</Th>
              <Th className="w-60">操作</Th>
              <Th>理由</Th>
              <Th className="w-36">IP</Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Tr key={row.id}>
                <Td><span className="text-caption text-ink-secondary">{formatDateTime(row.created_at)}</span></Td>
                <Td><span className="block truncate text-caption font-bold text-ink">{row.staff_name}</span></Td>
                <Td><span className="block truncate text-caption text-ink" title={row.tenant_name ?? ''}>{row.tenant_name ?? '—'}</span></Td>
                <Td>{auditActionChip(row.action)}</Td>
                <Td><span className="block truncate text-caption text-ink-secondary" title={row.reason ?? ''}>{row.reason ?? '—'}</span></Td>
                <Td><span className="text-caption text-ink-faint">{row.ip ?? '—'}</span></Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-caption text-ink-faint">
        <span>{total} 件中 {first}〜{last} 件を表示</span>
        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} ariaLabel="監査ログのページ" disabled={loading} />
      </div>
    </div>
  )
}
