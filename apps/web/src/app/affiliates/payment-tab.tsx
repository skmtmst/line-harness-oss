'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import KpiCard from '@/components/dashboard/kpi-card'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { DataTable, NameCell, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { api, type AffiliatePaymentSummary } from '@/lib/api'

type PaymentFilter = 'all' | 'approved' | 'held' | 'cycle_missing'

function yen(value: number): string {
  return `¥${Math.round(value).toLocaleString('ja-JP')}`
}

function holdDetail(item: AffiliatePaymentSummary): string {
  if (item.holdDays === null || item.holdDays === 0) return '保留なし'
  if (item.holdStatusUnknown > 0) {
    return `${item.holdDays}日保留・${item.holdStatusUnknown}件は承認日時を確認できません`
  }
  return `${item.holdDays}日保留`
}

/*
  **どのLINEアカウントの支払いかを渡す。** 口（#763）はアカウント単位で返す。
  渡さないと、ほかの店の未払いまで混ざった額を見せることになる。
*/
export default function AffiliatePaymentTab({ accountId }: { accountId: string }) {
  const [items, setItems] = useState<AffiliatePaymentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PaymentFilter>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const response = await api.affiliates.paymentSummaries(accountId)
      if (!response.success) throw new Error('payment summary unavailable')
      /*
        **返事が一覧の形かを確かめる。** 形が違うものをそのまま入れると、
        すぐ下の `items.reduce` で**画面ごと落ちる**。
        お金の画面が落ちると、いくら払うべきかを確かめる手段が無くなる。
        読めないときは0件ではなく「読めなかった」として出す。
      */
      if (!Array.isArray(response.data)) throw new Error('payment summary malformed')
      setItems(response.data)
    } catch {
      setItems([])
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  const summary = useMemo(() => {
    const approvedReward = items.reduce((sum, item) => sum + item.approvedReward, 0)
    const heldReward = items.reduce((sum, item) => sum + item.heldReward, 0)
    const unknownHold = items.reduce((sum, item) => sum + item.holdStatusUnknown, 0)
    return {
      approvedReward,
      approvedPeople: items.filter((item) => item.approvedConversions > 0).length,
      heldReward,
      unknownHold,
      cycleConfigured: items.filter((item) => Boolean(item.payoutCycle?.trim())).length,
    }
  }, [items])

  const shown = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ja-JP')
    return items.filter((item) => {
      if (normalized && !`${item.affiliateName} ${item.code}`.toLocaleLowerCase('ja-JP').includes(normalized)) {
        return false
      }
      if (filter === 'approved') return item.approvedConversions > 0
      if (filter === 'held') return item.heldConversions > 0 || item.holdStatusUnknown > 0
      if (filter === 'cycle_missing') return !item.payoutCycle?.trim()
      return true
    })
  }, [filter, items, query])

  const summaryUnavailable = error && !loading

  return (
    <div className="space-y-4" data-payment-ledger="not-connected">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="承認済み報酬の合計"
          value={summaryUnavailable ? null : summary.approvedReward}
          unit="円"
          detail={summaryUnavailable
            ? '読み込めませんでした'
            : `${summary.approvedPeople.toLocaleString('ja-JP')}人分・支払済みかは未取得`}
          loading={loading}
        />
        <KpiCard
          title="保留期間内"
          value={summaryUnavailable ? null : summary.heldReward}
          unit="円"
          detail={summaryUnavailable
            ? '読み込めませんでした'
            : summary.unknownHold > 0
              ? `確認できた分・${summary.unknownHold}件は承認日時未取得`
              : '承認日時と保留日数から集計'}
          badge={!summaryUnavailable && summary.unknownHold > 0 ? '一部未取得' : undefined}
          badgeTone={!summaryUnavailable && summary.unknownHold > 0 ? 'neutral' : undefined}
          loading={loading}
        />
        <KpiCard
          title="次の締め"
          value={null}
          unit=""
          detail="締め日を計算する設定は未接続"
          loading={loading}
        />
        <KpiCard
          title="支払い条件の覚書"
          value={summaryUnavailable ? null : summary.cycleConfigured}
          unit="人"
          detail={summaryUnavailable ? '読み込めませんでした' : '計算には使わないメモ'}
          loading={loading}
        />
      </div>

      <div className="rounded-control border border-info bg-info-bg px-4 py-3 text-sm text-info">
        支払済みの記録がまだ無いため、ここでは「未払い残高」や「今年払った合計」を表示しません。承認済み成果から確認できる合計だけを表示しています。
      </div>
      <div className="rounded-control border border-warning bg-warning-bg px-4 py-3 text-sm text-warning">
        振込先と締め処理は未接続です。この画面から支払いの確定や振込用CSVの作成はできません。現在の紹介者データは、すべてのLINEアカウントで共通です。
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="アフィリエイター名・コードで探す"
          aria-label="アフィリエイター名・コードで探す"
          className="border-hairline rounded-control min-w-0 flex-1 border px-3 py-2 text-sm"
          style={{ maxWidth: 460 }}
        />
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as PaymentFilter)}
          aria-label="支払い一覧の絞り込み"
          className="border-hairline rounded-control border px-3 py-2 text-sm"
        >
          <option value="all">すべて</option>
          <option value="approved">承認済みあり</option>
          <option value="held">保留中・確認待ち</option>
          <option value="cycle_missing">支払い条件の覚書なし</option>
        </select>
        <Button href="/conversions?tab=affiliates">支払い条件を確認</Button>
      </div>

      {loading ? (
        <ListState kind="loading" />
      ) : error ? (
        <ListState
          kind="error"
          title="支払いの集計を表示できませんでした"
          description="承認済み報酬を0円とは扱っていません。状態を読み直してください。"
          action={<Button onClick={() => { void load() }}>再読み込み</Button>}
        />
      ) : items.length === 0 ? (
        <ListState
          kind="empty"
          title="アフィリエイターがまだいません"
          description="アフィリエイターを登録すると、承認済み報酬をここで確認できます。"
        />
      ) : shown.length === 0 ? (
        <ListState
          kind="empty"
          title="条件に合う人はいません"
          description="検索または絞り込みを変えてください。"
        />
      ) : (
        <DataTable>
          <thead>
            <TableHeadRow>
              <Th style={{ width: '25%' }}>払う相手</Th>
              <Th style={{ width: '16%' }} align="right">承認済みの合計</Th>
              <Th style={{ width: '12%' }} align="right">中身</Th>
              <Th style={{ width: '17%' }}>保留</Th>
              <Th style={{ width: '18%' }}>支払い条件の覚書</Th>
              <Th style={{ width: '12%' }}>振込先</Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {shown.map((item) => (
              <Tr key={item.affiliateId}>
                <NameCell name={item.affiliateName} sub={`コード ${item.code}`} />
                <Td align="right" className="font-semibold tabular-nums">{yen(item.approvedReward)}</Td>
                <Td align="right" className="tabular-nums">承認済み {item.approvedConversions.toLocaleString('ja-JP')}件</Td>
                <Td>
                  <span className="block font-medium tabular-nums">{yen(item.heldReward)}・{item.heldConversions.toLocaleString('ja-JP')}件</span>
                  <span className="text-ink-faint mt-0.5 block text-xs">{holdDetail(item)}</span>
                </Td>
                <Td>
                  {item.payoutCycle?.trim()
                    ? <span className="block truncate" title={item.payoutCycle}>{item.payoutCycle}</span>
                    : <span className="text-ink-faint">—（覚書なし）</span>}
                </Td>
                <Td>
                  <span className="text-ink-faint block">—</span>
                  <span className="text-ink-faint block text-xs">未接続</span>
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  )
}
