'use client'

import Link from 'next/link'
import { Banknote, Hourglass, Sparkles, Wallet } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, type OpsDashboard, type OpsDashboardPeriod, type OpsLineUnregistered } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { opsCall } from '@/components/ops/ops-ui'
import { opsEnvironmentLabel } from '@/components/ops/ops-env-bar'
import { formatYen } from '@/components/ops/ops-charts'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import Dialog from '@/components/shared/dialog'
import KpiCard from '@/components/shared/kpi-card'
import kpiStyles from '@/components/shared/kpi-card.module.css'
import ListState from '@/components/shared/list-state'
import SegmentedControl from '@/components/shared/segmented'
import { OpsHead } from './shell'
import parts from './parts.module.css'
import styles from './dashboard.module.css'

/**
 * 運営ダッシュボード V8（絵 `CyW0E`）。
 *
 * 動きは v7（app/ops/dashboard）と同じ口を使う：期間（今月・先月・今年）で
 * /api/ops/dashboard を読み直す。要対応の4行は契約先一覧・お問い合わせへの入口。
 * 「Stripe と同期」は書ける運営メンバー（readOnly でない人）にだけ出す。
 */

const PERIODS: Array<{ value: OpsDashboardPeriod; label: string }> = [
  { value: 'month', label: '今月' },
  { value: 'prev_month', label: '先月' },
  { value: 'year', label: '今年' },
]

export default function OpsDashboardV8() {
  const [period, setPeriod] = useState<OpsDashboardPeriod>('month')
  const [data, setData] = useState<OpsDashboard | null>(null)
  const [error, setError] = useState('')
  const [canSyncBilling, setCanSyncBilling] = useState(false)
  const [syncingBilling, setSyncingBilling] = useState(false)
  const [billingSyncNotice, setBillingSyncNotice] = useState('')
  const [billingSyncError, setBillingSyncError] = useState('')
  const [unregistered, setUnregistered] = useState<OpsLineUnregistered | null>(null)
  const [unregisteredError, setUnregisteredError] = useState('')
  const [showUnregistered, setShowUnregistered] = useState(false)

  const load = useCallback(async () => {
    setError('')
    const res = await opsCall(api.ops.dashboard(period))
    if (!res.success) { setError(res.error || '読み込めませんでした'); return }
    setData(res.data)
  }, [period])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    let active = true
    void (async () => {
      const res = await opsCall(api.ops.me())
      if (active) setCanSyncBilling(Boolean(res.success && !res.data.readOnly))
    })()
    return () => { active = false }
  }, [])

  // 下の「未登録の権限者」の1行のため、先に読む（窓を開いたときの読み直しは openUnregistered）。
  useEffect(() => {
    if (!data || unregistered || unregisteredError) return
    let active = true
    void (async () => {
      const res = await opsCall(api.ops.lineUnregistered())
      if (!active) return
      if (res.success) setUnregistered(res.data)
      else setUnregisteredError(res.error || '読み込めませんでした')
    })()
    return () => { active = false }
  }, [data, unregistered, unregisteredError])

  const syncBilling = async () => {
    setSyncingBilling(true)
    setBillingSyncNotice('')
    setBillingSyncError('')
    const res = await opsCall(api.ops.billingSync())
    if (!res.success) {
      setBillingSyncError(res.error || 'Stripe と同期できませんでした')
      setSyncingBilling(false)
      return
    }
    setBillingSyncNotice(`Stripe から ${res.data.imported} 件取り込みました（失敗 ${res.data.failed} 件）`)
    await load()
    setSyncingBilling(false)
  }

  const openUnregistered = async () => {
    setShowUnregistered(true)
    if (unregistered) return
    setUnregisteredError('')
    const res = await opsCall(api.ops.lineUnregistered())
    if (!res.success) { setUnregisteredError(res.error || '読み込めませんでした'); return }
    setUnregistered(res.data)
  }

  const k = data?.kpis ?? null
  const loading = data === null && !error

  return (
    <div data-design-node="CyW0E">
      <OpsHead
        title="ダッシュボード"
        description="契約先の売上・使用量・お問い合わせを見て、要対応から片づけます。"
        environment={opsEnvironmentLabel(process.env.NEXT_PUBLIC_API_URL)}
        actions={<SegmentedControl aria-label="期間" value={period} onChange={setPeriod} options={PERIODS} />}
      />

      {!data && error ? (
        <div className={parts.panel}>
          <ListState kind="error" title="ダッシュボードを表示できませんでした" description={error} onRetry={() => void load()} />
        </div>
      ) : (
        <div className={parts.stack}>
          {error ? <p role="alert" className={parts.alert}>{error}</p> : null}
          <div className={`${parts.kpis} ${kpiStyles.strip}`}>
            <KpiCard presentation="cell" icon={<Wallet size={13} aria-hidden="true" />} title="契約中の月額合計" value={null} unit="" valueText={k ? formatYen(k.contractMonthlyTotal) : undefined} detail={k && data ? `契約中 ${k.active}・決済失敗 ${data.alerts.pastDue}（トライアルは入れない）` : '—'} loading={loading} />
            <KpiCard presentation="cell" icon={<Banknote size={13} aria-hidden="true" />} title="今月の売上（入金済み）" value={null} unit="" valueText={k ? formatYen(k.revenueThisMonth) : undefined} detail={data ? `決済失敗 ${data.alerts.pastDue} 社` : '—'} loading={loading} />
            <KpiCard presentation="cell" icon={<Hourglass size={13} aria-hidden="true" />} title="トライアル中" value={k ? k.trialing : null} unit="社" detail={data ? `期限 3日以内 ${data.alerts.trialEndingSoon}` : '—'} loading={loading} />
            <KpiCard presentation="cell" icon={<Sparkles size={13} aria-hidden="true" />} title="今月の AI 利用" value={data?.ai?.callsThisMonth ?? null} unit="枚" detail={data?.ai ? 'バナー生成・下書き' : '—'} loading={loading} />
          </div>

          <div className={parts.row}>
            <section aria-label="要対応" className={parts.panel}>
              <h3 className={parts.panelTitle}>要対応</h3>
              {data ? (
                <div className={parts.mini}>
                  <div className={parts.miniHead}>
                    <span className={parts.grow}>何が</span>
                    <span className={`${parts.num} ${styles.colCount}`}>件数</span>
                    <span className={`${parts.fixed} ${styles.colOpen}`} aria-hidden="true" />
                  </div>
                  <AlertRow label="決済が失敗している契約先" count={data.alerts.pastDue} href="/ops/tenants?status=past_due" />
                  <AlertRow label="トライアル期限が3日以内" count={data.alerts.trialEndingSoon} href="/ops/tenants?status=trialing" />
                  <AlertRow label="LINEのトークン期限が近い店舗" count={data.alerts.lineTokenExpiring} href="/ops/tenants" />
                  <AlertRow label="未返信のお問い合わせ" count={data.alerts.unansweredTickets} href="/ops/support" />
                </div>
              ) : <ListState kind="loading" title="読み込んでいます" />}
            </section>
            <section aria-label="月ごとの売上" className={parts.panel}>
              <h3 className={parts.panelTitle}>月ごとの売上</h3>
              {data ? <RevenueColumns rows={data.revenueByMonth} /> : <ListState kind="loading" title="読み込んでいます" />}
              <div className={styles.chartFoot}>
                <p className={parts.note}>単位：千円（月額の合計）・{data ? revenueSourceLabel(data.pricing, data.lastSyncedAt) : '—'}</p>
                {canSyncBilling ? (
                  <Button size="compact" disabled={syncingBilling} busy={syncingBilling} busyLabel="同期しています…" onClick={() => void syncBilling()}>Stripe と同期</Button>
                ) : null}
              </div>
              {billingSyncNotice ? <p role="status" className={parts.status}>{billingSyncNotice}</p> : null}
              {billingSyncError ? <p role="alert" className={parts.alert}>{billingSyncError}</p> : null}
            </section>
          </div>

          <div className={parts.row}>
            <section aria-label="上限に近い契約先" className={parts.panel}>
              <h3 className={parts.panelTitle}>上限に近い契約先</h3>
              {!data ? (
                <ListState kind="loading" title="読み込んでいます" />
              ) : data.usage.length === 0 ? (
                <ListState kind="empty" title="今月はまだ使用量がありません" description="配信・バナー生成・メディア登録があると、上限に近い契約先から順に並びます。" />
              ) : (
                <div className={parts.mini}>
                  <div className={parts.miniHead}>
                    <span className={parts.grow}>契約先</span>
                    <span className={`${parts.fixed} ${styles.colPlan}`}>プラン</span>
                    <span className={`${parts.num} ${styles.colRate}`}>配信通数</span>
                    <span className={`${parts.num} ${styles.colRate}`}>バナー生成</span>
                    <span className={`${parts.num} ${styles.colMedia}`}>メディア容量</span>
                  </div>
                  {data.usage.map((row) => (
                    <div key={row.tenantId} className={parts.miniRow}>
                      <Link href={`/ops/tenants/detail?id=${encodeURIComponent(row.tenantId)}`} className={`${parts.grow} ${parts.link}`} title={row.tenantName}>{row.tenantName}</Link>
                      <span className={`${parts.fixed} ${styles.colPlan}`}>{row.planLabel}</span>
                      <span className={`${parts.num} ${styles.colRate}`}>{usagePercent(row.messages, row.limits.messages)}</span>
                      <span className={`${parts.num} ${styles.colRate}`}>{usagePercent(row.bannerUnits, row.limits.images)}</span>
                      <span className={`${parts.num} ${styles.colMedia}`}>{usagePercent(row.mediaBytes, row.limits.mediaBytes)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section aria-label="お問い合わせ（チケット）" className={`${parts.panel} ${styles.tickets}`}>
              <h3 className={parts.panelTitle}>お問い合わせ（チケット）</h3>
              {data ? (
                <>
                  <div className={styles.stats}>
                    <MiniStat label="未対応" value={`${data.tickets.newCount} 件`} />
                    <MiniStat label="対応中" value={`${data.tickets.inProgressCount} 件`} />
                    <MiniStat label="平均の初回返信" value={hoursLabel(data.tickets.avgFirstReplyMinutes)} />
                  </div>
                  <Link href="/ops/support" className={parts.textLink}>すべて見る →</Link>
                </>
              ) : <ListState kind="loading" title="読み込んでいます" />}
            </section>
          </div>

          <div className={parts.row}>
            <section aria-label="プラン別の契約" className={parts.panel}>
              <h3 className={parts.panelTitle}>プラン別の契約</h3>
              {data ? <p className={parts.line}>{planShareLine(data.planShare.rows)}</p> : <ListState kind="loading" title="読み込んでいます" />}
            </section>
            <section aria-label="契約者専用LINEに未登録の権限者" className={parts.panel}>
              <h3 className={parts.panelTitle}>契約者専用LINEに未登録の権限者</h3>
              {data ? (
                <div className={styles.lineRow}>
                  <p className={parts.line}>{lineUnregisteredLine(data.lineRegistration.unregisteredCount, unregistered)}</p>
                  {data.lineRegistration.unregisteredCount > 0 ? (
                    <button type="button" className={parts.textLink} onClick={() => void openUnregistered()}>
                      {`未登録の${data.lineRegistration.unregisteredCount}人を見る`}
                    </button>
                  ) : null}
                </div>
              ) : <ListState kind="loading" title="読み込んでいます" />}
            </section>
          </div>
        </div>
      )}

      <Dialog
        open={showUnregistered}
        title="契約者専用LINEに未登録の権限者"
        description="契約者専用LINEの案内は、お知らせ配信の LINE の口ができてから、ここから送れるようにします。いまは対象の人を確かめられます。"
        onCancel={() => setShowUnregistered(false)}
      >
        {unregistered ? (
          unregistered.people.length === 0 ? (
            <p className={parts.line}>未登録の人はいません。</p>
          ) : (
            <div className={parts.mini}>
              {unregistered.people.map((p) => (
                <div key={p.staffId} className={parts.miniRow}>
                  <span className={parts.fixed}>{p.name}</span>
                  <span className={parts.grow}>{p.tenantName}</span>
                  {p.hasEmail ? null : <Chip tone="warn">メール未登録</Chip>}
                </div>
              ))}
            </div>
          )
        ) : unregisteredError ? (
          <ListState kind="error" title="未登録の人を表示できませんでした" description={unregisteredError} onRetry={() => void openUnregistered()} />
        ) : <ListState kind="loading" title="読み込んでいます" />}
      </Dialog>
    </div>
  )
}

function AlertRow({ label, count, href }: { label: string; count: number; href: string }) {
  return (
    <div className={`${parts.miniRow} ${styles.alertRow}`}>
      <span className={parts.grow}>{label}</span>
      <span className={`${parts.num} ${styles.colCount}`}>{count}</span>
      <span className={`${parts.fixed} ${styles.colOpen}`}>
        <Button href={href} aria-label={`${label}を開く`}>開く</Button>
      </span>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  )
}

/** 月ごとの売上の柱（千円）。いちばん高い月を柱の高さいっぱいにする。いまの月は濃い緑。 */
function RevenueColumns({ rows }: { rows: Array<{ label: string; yen: number; current: boolean }> }) {
  const max = Math.max(...rows.map((r) => r.yen), 0)
  return (
    <div className={styles.chart} role="img" aria-label={`月ごとの売上。${rows.map((r) => `${r.label} ${formatYen(r.yen)}`).join('、')}`}>
      {rows.map((r) => (
        <div key={r.label} className={styles.column}>
          <span
            className={`${styles.bar} ${r.current ? styles.barCurrent : ''}`}
            // 柱の高さは売上の割合で決まる（データの値）。
            style={{ blockSize: `${max > 0 ? Math.max((r.yen / max) * 100, 2) : 2}%` }}
            title={`${r.label} ${formatYen(r.yen)}`}
          />
          <span className={styles.columnLabel}>{r.label}</span>
        </div>
      ))}
    </div>
  )
}

function revenueSourceLabel(pricing: 'stripe_actual' | 'list_price', lastSyncedAt: string | null): string {
  if (pricing === 'list_price') return '定価で数えています'
  if (!lastSyncedAt) return 'Stripe の入金実績'
  const date = new Date(lastSyncedAt)
  if (!Number.isFinite(date.getTime())) return 'Stripe の入金実績'
  return `Stripe の入金実績（最終同期 ${formatDateTime(date)}）`
}

/** 平均の初回返信（2.4 時間のように小数1桁の時間）。 */
function hoursLabel(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return '—'
  return `${Math.round(Math.max(0, minutes) / 6) / 10} 時間`
}

/** 使用率（上限が無いときは —）。 */
function usagePercent(value: number, limit: number | null): string {
  if (limit === null || limit <= 0) return '—'
  return `${Math.round((value / limit) * 100)}%`
}

/** プラン別の契約の1行（スタンダード 1・プロ 1・…の順）。 */
function planShareLine(rows: Array<{ key: string; label: string; count: number }>): string {
  const order = ['standard', 'pro', 'light', 'trial']
  const byKey = new Map(rows.map((row) => [row.key, row]))
  const known = order.filter((key) => byKey.has(key)).map((key) => byKey.get(key)!)
  const rest = rows.filter((row) => !order.includes(row.key))
  return [...known, ...rest].map((row) => `${row.label} ${row.count}`).join('・') || '契約はまだありません'
}

/** 未登録の権限者の1行（メール未登録 M 人・LINE 未登録 N 人（店 1・店 1））。 */
function lineUnregisteredLine(unregisteredCount: number, unregistered: OpsLineUnregistered | null): string {
  if (!unregistered) return `LINE 未登録 ${unregisteredCount} 人`
  const noEmail = unregistered.people.filter((p) => !p.hasEmail).length
  const byTenant = new Map<string, number>()
  for (const p of unregistered.people) byTenant.set(p.tenantName, (byTenant.get(p.tenantName) ?? 0) + 1)
  const top = [...byTenant].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name, n]) => `${name} ${n}`)
  const tail = top.length > 0 ? `（${top.join('・')}）` : ''
  return `メール未登録 ${noEmail} 人・LINE 未登録 ${unregisteredCount} 人${tail}`
}
