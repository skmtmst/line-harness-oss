'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import { Field } from '@/components/shared/form-controls'
import Notice from '@/components/shared/notice'
import { formatNumber } from '@/lib/format'
import { currentSettlementPeriod, formatYen, listAllConversionApprovals } from './display'

type Counts = { clicks: number | null; friends: number | null; conversions: number | null; approved: number | null; reward: number | null; held: number | null }
const UNKNOWN: Counts = { clicks: null, friends: null, conversions: null, approved: null, reward: null, held: null }

/** 旧画面だけにあった月別の流れ。現役の一覧を組み替えず、共通窓から読める。 */
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
  const rows: Array<{ label: string; value: number | null; money?: boolean }> = [
    { label: 'クリック', value: counts.clicks }, { label: '友だち追加', value: counts.friends },
    { label: '成果', value: counts.conversions }, { label: '認めた・承認', value: counts.approved },
    { label: '確定した報酬', value: counts.reward, money: true }, { label: '保留している報酬', value: counts.held, money: true },
  ]
  return <Dialog open={open} title="今月の成果の流れ" onCancel={onClose} footer={<Button type="button" onClick={onClose}>閉じる</Button>}>
    <section aria-label="今月の成果の流れ" aria-busy={loading}>
      {rows.map((row) => <Field key={row.label} label={row.label} optional={false}><span>{row.value === null ? '—' : row.money ? formatYen(row.value) : `${formatNumber(row.value)}件`}</span></Field>)}
      {failed ? <Notice tone="danger" message="一部の集計を読み込めませんでした。取得できない数は「—」で表示しています。" action={<Button type="button" disabled={loading} onClick={() => setAttempt((current) => current + 1)}>もう一度読み込む</Button>} /> : null}
    </section>
  </Dialog>
}
