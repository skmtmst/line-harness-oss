'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import SectionHeader from '@/components/shared/section-header'
import Notice from '@/components/shared/notice'
import { formatPercent } from '@/lib/format'
import { currentSettlementPeriod, listAllConversionApprovals } from './display'

type Counts = { clicks: number | null; friends: number | null; conversions: number | null; approved: number | null; reward: number | null; held: number | null }
const UNKNOWN: Counts = { clicks: null, friends: null, conversions: null, approved: null, reward: null, held: null }

function stageRate(previous: number | null, next: number | null): string | undefined {
  if (previous === null || next === null || previous <= 0) return undefined
  const percent = next / previous * 100
  return Number.isFinite(percent) ? formatPercent(percent) : undefined
}

/** 今月の流れと報酬を、同じ期間の数として分けて読む。 */
export default function MonthlyFlow({ open, accountId, onClose }: { open: boolean; accountId: string | null; onClose: () => void }) {
  const [counts, setCounts] = useState<Counts>(UNKNOWN)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const period = currentSettlementPeriod()
    setCounts(UNKNOWN)
    setFailed(false)
    setLoading(true)
    const update = (patch: Partial<Counts>) => { if (!cancelled) setCounts((current) => ({ ...current, ...patch })) }
    const sum = (rows: unknown[], key: string) => {
      const values = rows.map((row) => row && typeof row === 'object' ? (row as Record<string, unknown>)[key] : undefined)
      if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) throw new Error('invalid count')
      return (values as number[]).reduce((total, value) => total + value, 0)
    }
    void Promise.allSettled([
      Promise.resolve().then(async () => {
        const response = await api.affiliates.allReport({ startDate: period.periodFrom, endDate: period.periodTo })
        if (!response.success || !Array.isArray(response.data)) throw new Error('monthly report failed')
        update({ clicks: sum(response.data, 'totalClicks'), friends: sum(response.data, 'friendAdds'), conversions: sum(response.data, 'totalConversions') })
      }),
      Promise.resolve().then(async () => {
        const response = await listAllConversionApprovals('approved', 0, { accountId, fresh: true })
        if (response.truncated) throw new Error('approval count incomplete')
        const from = Date.parse(period.periodFrom)
        const until = Date.parse(period.periodTo)
        update({ approved: response.items.filter((item) => { const at = Date.parse(item.createdAt); return at >= from && at <= until }).length })
      }),
      Promise.resolve().then(async () => {
        if (!accountId) throw new Error('account required')
        const response = await api.affiliates.settlementPreview(accountId, period)
        if (!response.success || !Number.isFinite(response.data.totalAmount)) throw new Error('settlement failed')
        update({ reward: response.data.totalAmount })
      }),
      Promise.resolve().then(async () => {
        if (!accountId) throw new Error('account required')
        const response = await api.affiliates.paymentSummaries(accountId)
        if (!response.success || !Array.isArray(response.data)) throw new Error('payment summary failed')
        update({ held: sum(response.data, 'heldReward') })
      }),
    ]).then((results) => { if (!cancelled) { setFailed(results.some((result) => result.status === 'rejected')); setLoading(false) } })
    return () => { cancelled = true }
  }, [open, accountId, attempt])
  const stages = [
    { label: 'クリック', value: counts.clicks }, { label: '友だち追加', value: counts.friends },
    { label: '成果', value: counts.conversions }, { label: '認めた・承認', value: counts.approved },
  ]
  const connections = stages.slice(1).map((stage, index) => ({
    label: `${stages[index].label}から${stage.label}`,
    value: stageRate(stages[index].value, stage.value),
  }))
  return <Dialog open={open} title="今月の成果の流れ" size="large" contentLayout="form" onCancel={onClose} >
      <SectionHeader title="成果までの流れ" helpLabel="流れの割合の説明" help="同じ期間の件数を比べた割合です。同じ人が順に進んだ割合ではなく、100%を超えることがあります。" />
      <KpiBand appearance="cards" connections={connections} role="group" aria-label="成果までの流れ" aria-busy={loading}>
        {stages.map((stage) => <KpiCard key={stage.label} title={stage.label} aria-label={stage.label} value={stage.value} unit="件" detail={null} presentation="band" />)}
      </KpiBand>
      <SectionHeader title="報酬" separation="section" />
      <KpiBand appearance="cards" layout="flow-summary" role="group" aria-label="報酬" aria-busy={loading}>
        <KpiCard title="確定した報酬" aria-label="確定した報酬" value={counts.reward} unit="円" detail={null} presentation="band" />
        <KpiCard title="保留している報酬" aria-label="保留している報酬" value={counts.held} unit="円" detail={null} presentation="band" />
      </KpiBand>
      {failed ? <Notice tone="danger" message="一部の集計を読み込めませんでした。取得できない数は「—」で表示しています。" action={<Button type="button" disabled={loading} onClick={() => setAttempt((current) => current + 1)}>もう一度読み込む</Button>} /> : null}
  </Dialog>
}
