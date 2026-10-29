'use client'

import { useEffect, useState } from 'react'
import { CircleDot } from 'lucide-react'
import { api, type OpsApplication } from '@/lib/api'
import { OpsListPage, OpsListToolbar } from './list-page'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { DataTable, TableHeadRow, Th, Td, Tr, NameCell, RowNameLink } from '@/components/shared/table'

const STATUS: Record<OpsApplication['status'], { label: string; tone: StatusBadgeTone }> = {
  pending: { label: '未対応', tone: 'caution' },
  contacted: { label: '連絡中', tone: 'warning' },
  approved: { label: '承認済み', tone: 'info' },
  rejected: { label: '見送り', tone: 'neutral' },
  activated: { label: '利用開始済み', tone: 'success' },
}

export default function OpsApplications() {
  const [rows, setRows] = useState<OpsApplication[]>([])
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setError('')
    try {
      const res = await api.ops.applications.list()
      if (!res.success) throw new Error(res.error || '申込を読み込めませんでした')
      setRows(res.data)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '申込を読み込めませんでした') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const visible = rows.filter((row) => {
    if (filter && row.status !== filter && !(filter === 'approved' && row.status === 'activated')) return false
    const query = q.trim().toLowerCase()
    return !query || [row.company_name, row.contact_name, row.email].some((value) => value.toLowerCase().includes(query))
  })
  const count = (status: OpsApplication['status']) => rows.filter((row) => row.status === status).length

  return <OpsListPage boardId="kWaRc" title="申込アカウント"
    help="申込内容を確認し、担当者から連絡した後に承認します。"
    opsNotice="承認するまで申込者はログインできません。操作は監査ログに記録されます。"
    stats={<KpiBand>
      <KpiCard presentation="cell" title="未対応" value={loading ? null : count('pending')} unit="件" detail="新しい申し込み" loading={loading} />
      <KpiCard presentation="cell" title="連絡中" value={loading ? null : count('contacted')} unit="件" detail="担当者の対応待ち" loading={loading} />
      <KpiCard presentation="cell" title="承認済み" value={loading ? null : count('approved') + count('activated')} unit="件" detail="招待メール送信済み" loading={loading} />
      <KpiCard presentation="cell" title="見送り" value={loading ? null : count('rejected')} unit="件" detail="利用不可" loading={loading} />
    </KpiBand>}
    toolbar={<OpsListToolbar
      search={{ value: q, onChange: setQ, placeholder: '会社名・担当者・メールで探す', label: '申込を探す' }}
      filters={<>
        <FilterChip icon={<CircleDot size={16} aria-hidden="true" />} selected={!filter} onChange={() => setFilter('')}>すべて {rows.length}</FilterChip>
        {(['pending', 'contacted', 'approved', 'rejected'] as const).map((key) => <FilterChip key={key} selected={filter === key} onChange={(selected) => setFilter(selected ? key : '')}>{STATUS[key].label}</FilterChip>)}
      </>} />}
  >
    {loading ? <ListState kind="loading" title="申込を読み込んでいます" />
      : error ? <ListState kind="error" title="申込を表示できませんでした" description={error} onRetry={() => void load()} />
      : visible.length === 0 ? <ListState kind="empty" title="該当する申し込みがありません" />
      : <DataTable aria-label="申込アカウント" columnSizing="content">
        <thead><TableHeadRow><Th grow>会社名</Th><Th>担当者</Th><Th>連絡先</Th><Th>きっかけ</Th><Th>状態</Th><Th>受付日</Th></TableHeadRow></thead>
        <tbody>{visible.map((row) => {
          const href = `/ops/applications/detail?id=${encodeURIComponent(row.id)}`
          return <Tr key={row.id} href={href}>
            <NameCell grow name={<RowNameLink href={href} title={row.company_name}>{row.company_name}</RowNameLink>} />
            <Td>{row.contact_name}</Td><Td><span>{row.email}</span><br /><span>{row.phone}</span></Td>
            <Td>{row.referral_source}</Td><Td><StatusBadge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</StatusBadge></Td>
            <Td>{new Date(row.created_at).toLocaleDateString('ja-JP')}</Td>
          </Tr>
        })}</tbody>
      </DataTable>}
  </OpsListPage>
}
