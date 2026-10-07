'use client'

/*
 * ★V8 飲食店のダッシュボード「今日のお店」（提案 E-1 `hKRRF`。採用 2026-10-07）。
 *
 * 板の頭（今日のお店・日付・営業時間・更新／＋ウォークイン・＋電話予約）→ 店のタブ
 * → 他の予約サイトの枠を閉じる知らせ → 今日の数（今日の予約・来店予定・空席（いま）・未返信の口コミ）
 * → 今日の予約の表（来店の印）｜右：予約サイト・グルメ媒体・Google の口コミ・Instagram の新着。
 * 全店の一覧（前の店舗ダッシュボード `CHz31`）は `?view=stores` で残す。動きは BEHAVIOR.md。
 */
import { useEffect, useMemo, useState } from 'react'
import { Armchair, Bell, CalendarCheck, Check, Plus, Star, Users } from 'lucide-react'
import { DashboardPage, DashboardRow } from '@/components/templates/dashboard-page'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import TextLink from '@/components/shared/text-link'
import { notifyToast } from '@/components/shared/toast'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { useStaffRole } from '@/lib/staff-role'
import { restaurantTestApi } from '@/lib/restaurant-test-api'
import PhoneReservationDrawer from '../front-desk/phone-drawer'
import WalkInDialog from '../front-desk/walk-in-dialog'
import { pad2 } from '../front-desk/slots'
import StoreTabs from '../store-tabs/store-tabs'
import StoresDashboardV8 from './stores'
import { SidePanel } from './side'
import { TodayTable } from './today-table'
import { canWriteRole, groupCloseTasks, openItems, reasonText, slotTitle, summarizeToday } from './summarize'
import { useStoreToday } from './use-store-today'
import styles from './dashboard.module.css'

function daysAgo(iso: string, now: number): string {
  const days = Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000))
  return days === 0 ? '今日' : `${days}日前`
}

function headDescription(hours: ReturnType<typeof useStoreToday>['hours'], updatedAt: Date | null): string {
  const now = new Date()
  const week = '日月火水木金土'[now.getDay()]
  const periods = hours?.find((day) => day.weekday === now.getDay())?.periods ?? null
  const open = hours === null ? null : periods && periods.length > 0 ? periods.map((p) => `${p.opensAt}〜${p.closesAt}`).join('・') : '休み'
  return [
    `${now.getMonth() + 1}月${now.getDate()}日（${week}）`,
    open ? `営業 ${open}` : null,
    updatedAt ? `更新 ${pad2(updatedAt.getHours())}:${pad2(updatedAt.getMinutes())}` : null,
  ].filter(Boolean).join(' ・ ')
}

/** 「LINE 7・電話 4・ウォークイン 1」。0 の経路は出さない（予約サイト経由もあれば足す）。 */
export function sourceBreakdown(summary: Pick<ReturnType<typeof summarizeToday>, 'line' | 'phone' | 'walkIn' | 'media'>): string {
  const parts = [['LINE', summary.line], ['電話', summary.phone], ['ウォークイン', summary.walkIn], ['予約サイト', summary.media]] as const
  const shown = parts.filter(([, n]) => n > 0).map(([label, n]) => `${label} ${n}`)
  return shown.length ? shown.join('・') : 'まだ予約はありません'
}

function TodayStore() {
  usePageTitle('店舗ダッシュボード')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const { selectedAccountId } = useAccount()
  const role = useStaffRole()
  const canWrite = canWriteRole(role)
  const d = useStoreToday(selectedAccountId)
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [walkInOpen, setWalkInOpen] = useState(false)
  const [busyId, setBusyId] = useState('')
  const now = Date.now()
  const tables = useMemo(() => (d.snapshot?.tables ?? []).filter((t) => t.store_id === d.store?.id), [d.snapshot, d.store])
  const summary = useMemo(() => (d.today ? summarizeToday(d.today, tables, now) : null), [d.today, tables]) // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => groupCloseTasks(d.closeTasks ?? [], d.media ?? []), [d.closeTasks, d.media])
  const pending = groups.filter((g) => g.state === 'open' || g.state === 'partly')
  const first = pending[0] ?? null
  const firstItem = first ? openItems(first)[0] ?? null : null
  const firstMedium = firstItem ? d.media?.find((m) => m.code === firstItem.channel) ?? null : null
  const google = d.google
  const googleConnected = google?.connection.status === 'connected'

  const markVisited = async (id: string) => {
    if (!d.accountId) return
    setBusyId(id)
    try {
      await restaurantTestApi.postSeatVisitMark(d.accountId, id, { kind: 'visited' })
      notifyToast('来店にしました。')
      await d.reload()
    } catch (caught) {
      notifyToast(caught instanceof Error && caught.message ? caught.message : '来店にできませんでした。', { tone: 'error' })
      await d.reload()
    } finally {
      setBusyId('')
    }
  }

  const undoVisited = async (id: string) => {
    if (!d.accountId) return
    setBusyId(id)
    try {
      await restaurantTestApi.deleteSeatVisitMark(d.accountId, id)
      notifyToast('来店の印を取り消しました。')
    } catch (caught) {
      notifyToast(caught instanceof Error && caught.message ? caught.message : '取り消せませんでした。', { tone: 'error' })
    } finally {
      await d.reload()
      setBusyId('')
    }
  }

  const closeOne = async (taskId: string, name: string) => {
    if (!d.accountId) return
    setBusyId(taskId)
    try {
      await restaurantTestApi.completeChannelCloseTask(d.accountId, taskId)
      notifyToast(`${name}の枠を閉じた印を付けました。`)
    } catch (caught) {
      notifyToast(caught instanceof Error && caught.message ? caught.message : '印を付けられませんでした。', { tone: 'error' })
    } finally {
      await d.reload()
      setBusyId('')
    }
  }

  const actions = canWrite && d.store ? (
    <>
      <Button onClick={() => setWalkInOpen(true)}><Plus size={15} aria-hidden="true" />ウォークイン</Button>
      <Button variant="primary" onClick={() => setPhoneOpen(true)}><Plus size={15} aria-hidden="true" />電話予約</Button>
    </>
  ) : null

  let body
  if (d.loading && !d.snapshot) {
    body = <div className={styles.state}><ListState kind="loading" /></div>
  } else if (d.error && !d.snapshot) {
    body = <div className={styles.state}><ListState kind="error" error={d.error} onRetry={() => window.location.reload()} /></div>
  } else if (!d.store) {
    body = <div className={styles.state}><ListState kind="empty" title="店舗が登録されていません" description="統括から店舗を登録してください。" /></div>
  } else {
    body = (
      <>
        {first ? (
          <div className={styles.closeRow}>
            <div className={styles.closeBand} role="status" data-close-band="">
              <Bell size={18} aria-hidden="true" className={styles.closeIcon} />
              <div className={styles.closeText}>
                <p className={styles.closeTitle}>{`他の予約サイトの枠を閉じてください（未対応 ${pending.length}件）`}</p>
                <p className={styles.closeDetail}>
                  {`${slotTitle(first.startsAt)} の枠が${reasonText(first)} → ${openItems(first).map((item) => item.name).join('・')} の枠を閉じてください`}
                </p>
              </div>
              {firstMedium?.adminUrl ? (
                <Button href={firstMedium.adminUrl} target="_blank" rel="noopener noreferrer">{`${firstMedium.name}の管理画面を開く ↗`}</Button>
              ) : null}
              {canWrite && firstItem ? (
                <Button onClick={() => void closeOne(firstItem.id, firstItem.name)} disabled={busyId === firstItem.id} aria-label={`${firstItem.name}の枠を閉じた`}>
                  <Check size={15} aria-hidden="true" />閉じた
                </Button>
              ) : null}
              <TextLink href="/restaurant-test/close-tasks">すべて見る</TextLink>
            </div>
          </div>
        ) : null}
        <div className={styles.stats}>
          <KpiBand gridClassName="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiCard
              presentation="band"
              title="今日の予約"
              icon={<CalendarCheck size={13} aria-hidden="true" />}
              value={summary?.groups ?? null}
              unit="組"
              loading={!summary}
              detail={summary ? sourceBreakdown(summary) : '読み込んでいます'}
              action={{ label: '予約台帳を開く', href: '/restaurant-test/reservations' }}
            />
            <KpiCard
              presentation="band"
              title="来店予定"
              icon={<Users size={13} aria-hidden="true" />}
              value={summary?.guests ?? null}
              unit="人"
              loading={!summary}
              detail={summary ? (summary.peak ? `いちばん多いのは ${summary.peak.label}（${summary.peak.guests}人）` : '今日の予約はまだありません') : '読み込んでいます'}
              action={{ label: '時間ごとに見る', href: '/restaurant-test/reservations' }}
            />
            <KpiCard
              presentation="band"
              title="空席（いま）"
              icon={<Armchair size={13} aria-hidden="true" />}
              value={summary?.freeTables ?? null}
              unit="卓"
              loading={!summary}
              detail={summary ? `全 ${summary.totalTables} 卓${summary.counterSeats ? `・カウンター ${summary.counterSeats} 席` : ''}` : '読み込んでいます'}
              help="動いている卓のうち、いま予約が重なっていない卓の数です。"
              action={{ label: '席を見る', href: '/restaurant-test/tables' }}
            />
            <KpiCard
              presentation="band"
              title="未返信の口コミ"
              icon={<Star size={13} aria-hidden="true" />}
              value={googleConnected ? google.summary.unrepliedCount : null}
              unit="件"
              delta={googleConnected && d.oldestReview ? <Chip tone="warn">{`最長 ${daysAgo(d.oldestReview.createTime, now)}`}</Chip> : null}
              detail={googleConnected
                ? `Google ★${google.connection.averageRating ?? '—'}（${google.connection.totalReviewCount ?? 0}件）`
                : google ? 'Google ビジネスとつないでいません' : '読み込めませんでした'}
              action={googleConnected ? { label: '返信する', href: '/restaurant-test/google' } : { label: 'つなぐ', href: '/settings/sns' }}
            />
          </KpiBand>
        </div>
        <DashboardRow
          asideSize="wide"
          aside={<SidePanel media={d.media} google={google} latestReview={d.latestReview} canWrite={canWrite} now={now} />}
        >
          <TodayTable
            rows={d.today}
            canWrite={canWrite}
            busyId={busyId}
            onVisited={(id) => void markVisited(id)}
            onUndo={(id) => void undoVisited(id)}
          />
        </DashboardRow>
      </>
    )
  }

  return (
    <DashboardPage
      boardId="hKRRF"
      headingSize="compact"
      title="今日のお店"
      description={d.store ? headDescription(d.hours, d.updatedAt) : undefined}
      actions={actions}
      tabs={<StoreTabs current="dashboard" flush />}
    >
      {body}
      {d.store ? (
        <>
          <PhoneReservationDrawer
            open={phoneOpen}
            accountId={d.accountId}
            storeId={d.store.id}
            tables={tables}
            onClose={() => setPhoneOpen(false)}
            onSaved={({ lineFailed }) => {
              setPhoneOpen(false)
              notifyToast(lineFailed ? '予約は入れました。LINE の確認は送れていません。' : '予約を入れました。', lineFailed ? { tone: 'error' } : undefined)
              void d.reload()
            }}
          />
          <WalkInDialog
            open={walkInOpen}
            accountId={d.accountId}
            storeId={d.store.id}
            tables={tables}
            onClose={() => setWalkInOpen(false)}
            onSaved={({ seated }) => {
              setWalkInOpen(false)
              notifyToast(seated ? '入店にしました。' : '席は取りました。来店の印は付けられませんでした。表の［来店］を押してください。', seated ? undefined : { tone: 'error' })
              void d.reload()
            }}
          />
        </>
      ) : null}
    </DashboardPage>
  )
}

/** `?view=stores` のときは全店の一覧（前の店舗ダッシュボード `CHz31`）。 */
export default function RestaurantDashboardV8() {
  const [view, setView] = useState<'today' | 'stores' | null>(null)
  useEffect(() => {
    setView(new URLSearchParams(window.location.search).get('view') === 'stores' ? 'stores' : 'today')
  }, [])
  if (view === null) return null
  return view === 'stores' ? <StoresDashboardV8 /> : <TodayStore />
}
