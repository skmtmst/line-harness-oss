'use client'
import { useEffect, useState } from 'react'
import { api, type EcCommerceOverview, type EcOrderList } from '@/lib/api'
import SectionHeader from '@/components/shared/section-header'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Button from '@/components/shared/button'
import { formatDateTime } from '@/lib/format'
import { DashboardRow } from '@/components/templates/dashboard-page'
import EcPeriodSummary from './ec-period'

/** 既存ECの読取りだけを使う。模擬の自動LINEは実績へ混ぜない。 */
export default function EcSummary({ accountId, period = 'today' }: { accountId: string; period?: 'today' | 'last7' | 'last30' }) {
  const [snapshot, setSnapshot] = useState<{ accountId: string; overview: EcCommerceOverview; orders: EcOrderList; configured: boolean; at: string } | null>(null)
  const [failure, setFailure] = useState<{ accountId: string; error: unknown } | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let active = true
    setSnapshot(null); setFailure(null)
    void Promise.all([api.ecCommerce.overview(accountId), api.ecCommerce.orders({ lineAccountId: accountId, limit: 1 }), api.ecCommerce.connector(accountId)]).then(([overview, orders, connector]) => {
      if (!overview.success || !orders.success || !connector.success) throw new Error('ECの状況を読み込めませんでした')
      if (active) setSnapshot({ accountId, overview: overview.data, orders: orders.data, configured: connector.data.configured || orders.data.total > 0 || overview.data.total > 0, at: new Date().toISOString() })
    }).catch(error => { if (active) setFailure({ accountId, error }) })
    return () => { active = false }
  }, [accountId, tick])
  const data = snapshot?.accountId === accountId ? snapshot : null
  const error = failure?.accountId === accountId ? failure.error : null
  const values = data?.configured ? data : null
  return <DashboardRow>
    <SectionHeader title="ECの状況" note={data ? `取得 ${formatDateTime(data.at)}` : undefined} help="接続先から取り込んだ全期間の注文・現在の定期便・つき合わせ待ちです。模擬の自動LINEは含みません。" helpLabel="ECの状況の説明" href="/ec-commerce" linkLabel="注文を見る" />
    {error ? <ListState kind="error" title="ECの状況を読み込めませんでした" error={error} onRetry={() => setTick(n => n + 1)} /> : null}
    <EcPeriodSummary accountId={accountId} period={period} />
    <KpiBand>
      <KpiCard presentation="band" title="注文" value={values?.orders.summary.current ?? null} unit="件" detail="全期間・取消と返金を除く" action={{ label: '注文を見る', href: '/ec-commerce' }} />
      <KpiCard presentation="band" title="定期便" value={values?.overview.subscriptions ?? null} unit="件" detail="現在の契約数" action={{ label: '定期便を見る', href: '/ec-commerce?tab=subscriptions' }} />
      <KpiCard presentation="band" title="つき合わせ待ち" value={values?.overview.identityPending ?? null} unit="件" detail="友だちとのつき合わせ" action={{ label: 'つき合わせを確認する', href: '/ec-commerce/identity-candidates' }} />
    </KpiBand>
    <Notice tone="info" action={<Button href="/ec-commerce?tab=connector">ECの接続を確認する</Button>}>未接続・未取得の数字は「—」です。自動のLINEの設定と模擬確認は、EC連携の「自動LINE」から確認できます。</Notice>
  </DashboardRow>
}
