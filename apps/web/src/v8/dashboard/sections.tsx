'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { Bell, Send, TriangleAlert, UserPlus } from 'lucide-react'
import type { NotificationCenterItem } from '@line-crm/shared'
import { api, type BookingRequest, type DashboardOverview, type DashboardUpcoming, type DeliveryFailureOrigins } from '@/lib/api'
import SectionHeader from './head'
import ActivityItem from '@/components/shared/activity-item'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { STATE_TEXT } from '@/components/shared/not-connected'
import { activeUpcomingBookings } from '@/components/dashboard/side-cards'
import { dashboardFreshnessText, dashboardLocalUpdatedAt } from '@/components/dashboard/freshness'
import { dashboardNotificationDestination } from '@/components/dashboard/notification-summary'
import { formatWaitRough } from '@/lib/format-duration'
import { formatDateTime, formatNumber, formatTime, formatRelative } from '@/lib/format'
import type { HealthRisk } from './use-dashboard'
import styles from './dashboard.module.css'

type Section = NonNullable<DashboardOverview['sections']>[keyof NonNullable<DashboardOverview['sections']>]

/** 段の下の「更新 9:30」。取れないときは何も出さない。 */
export function Updated({ children }: { children: ReactNode }) {
  if (!children) return null
  return <p className={styles.updated} title={typeof children === 'string' ? children : undefined}>{children}</p>
}

export function sectionUpdated(section: Section | undefined): string | null {
  if (!section?.freshness) return null
  return dashboardFreshnessText(section.freshness, section.asOf, section.reason)
}

/** 札（WQmep の黄色い札）。tone で緑・赤も出す。 */
export function Tag({ children, tone = 'warning' }: { children: ReactNode; tone?: 'warning' | 'success' | 'danger' }) {
  return <span className={tone === 'success' ? `${styles.tag} ${styles.tag_success}` : tone === 'danger' ? `${styles.tag} ${styles.tag_danger}` : `${styles.tag} ${styles.tag_warning}`}>{children}</span>
}

/** 鍵と値の1行。`href` があれば行ごと押せる（その状態で絞った一覧へ）。 */
export function KeyValue({ label, value, tone = 'default', dot, href, title }: {
  label: string
  value: ReactNode
  tone?: 'default' | 'danger' | 'success' | 'faint'
  dot?: 'success' | 'danger' | 'faint'
  href?: string
  title?: string
}) {
  const body = (
    <>
      {dot ? <span className={dot === 'success' ? `${styles.dot} ${styles.dot_success}` : dot === 'danger' ? `${styles.dot} ${styles.dot_danger}` : styles.dot} aria-hidden="true" /> : null}
      <span className={styles.kvKey}>{label}</span>
      <span className={styles.kvValue}>{value}</span>
    </>
  )
  return href
    ? <Link href={href} className={tone === 'danger' ? `${styles.kv} ${styles.kv_danger}` : tone === 'faint' ? `${styles.kv} ${styles.kv_faint}` : styles.kv} title={title}>{body}</Link>
    : <div className={tone === 'danger' ? `${styles.kv} ${styles.kv_danger}` : tone === 'faint' ? `${styles.kv} ${styles.kv_faint}` : styles.kv}>{body}</div>
}

export function Unavailable({ section, onRetry }: { section?: Section; onRetry: () => void }) {
  const partial = section?.status === 'partial'
  return (
    <p className={styles.note}>
      {partial ? `一部のデータを${STATE_TEXT.error}` : `データを${STATE_TEXT.error}`}
      <button type="button" className={styles.inlineButton} onClick={onRetry}>もう一度読み込む</button>
    </p>
  )
}

export function Loading({ label }: { label: string }) {
  return (
    <div aria-label={`${label}を${STATE_TEXT.loading}`}>
      <DelayedSkeleton loading skeleton={<div className={styles.skeletonStack}><Skeleton className="block h-5 w-full" /><Skeleton className="block h-5 w-2/3" /></div>} />
    </div>
  )
}

/* ── 右の列：今月の送信枠 ─────────────────────────── */
export function SendQuota({ delivery, metric, section, onRetry }: {
  delivery: DashboardOverview['delivery'] | null
  metric: NonNullable<DashboardOverview['metrics']>['monthlyQuota'] | undefined
  section?: Section
  onRetry: () => void
}) {
  const used = metric === undefined ? delivery?.quotaUsed ?? null : metric.value?.used ?? null
  const limit = metric === undefined ? delivery?.quotaLimit ?? null : metric.value?.limit ?? null
  const unlimited = metric?.value?.unlimited === true
  const notConnected = metric !== undefined && metric.state === 'unavailable' && metric.reason === 'not_connected'
  const failed = metric !== undefined && metric.state === 'unavailable' && metric.reason !== 'not_connected'
  const loading = metric === undefined && delivery === null
  const remaining = used !== null && limit !== null ? Math.max(0, limit - used) : null
  const rate = remaining !== null && limit ? Math.max(0, Math.min(100, remaining / limit * 100)) : null
  const low = rate !== null && rate <= 10
  const updated = sectionUpdated(section)
  const quotaText = [unlimited ? '契約種別：無制限' : rate === null ? null : `残り ${rate.toFixed(1)}%`, updated].filter(Boolean).join('・')
  return (
    <div className={styles.asideBlock}>
      <SectionHeader
        title="今月の送信枠"
        help="送信枠は毎月1日にリセットされます。使い切ると翌月1日まで送れません。"
        helpLabel="今月の送信枠の説明"
        href="/accounts"
        linkLabel="配信設定へ"
      />
      {loading ? <Loading label="送信枠" /> : (
        <p className={styles.quota}>
          {unlimited ? (
            <>
              <span className={styles.quotaPre}>LINE公式 使用</span>
              <span className={styles.quotaNum}>{used === null ? '—' : formatNumber(used)}</span>
              <span className={styles.quotaPre}>通（上限なし）</span>
            </>
          ) : (
            <>
              <span className={styles.quotaPre}>LINE公式 残り</span>
              <span className={styles.quotaNum}>{remaining === null ? '—' : formatNumber(remaining)}</span>
              <span className={styles.quotaPre}>{limit === null ? '' : `/ ${formatNumber(limit)}通`}</span>
            </>
          )}
        </p>
      )}
      {unlimited ? null : (
        <span className={styles.track} aria-hidden="true">
          <span className={low ? styles.fillDanger : styles.fill} style={{ width: `${rate ?? 0}%` }} />
        </span>
      )}
      {notConnected ? (
        <Updated>LINEアカウントが未接続です</Updated>
      ) : failed ? (
        <button type="button" onClick={onRetry} className={styles.retryDanger}>{`送信枠を${STATE_TEXT.error}。もう一度読み込む`}</button>
      ) : (
        <p className={low ? styles.updatedDanger : styles.updated} title={quotaText}>
          {quotaText}
        </p>
      )}
    </div>
  )
}

/* ── 右の列：運用アラート ─────────────────────────── */
export function OperationalAlerts({ risk, healthIssues, oldestWaitMinutes, twoFactor, referenceCount, failed, updatedAt }: {
  risk: HealthRisk
  healthIssues: number | null
  oldestWaitMinutes: number | null
  twoFactor: { enabled: number; total: number } | null
  referenceCount?: number
  failed?: boolean
  updatedAt?: Date | null
}) {
  const currentHealthIssue = risk === 'warning' || risk === 'danger'
  const count = referenceCount ?? (risk === null ? null : currentHealthIssue ? Math.max(1, healthIssues ?? 1) : 0)
  return (
    <div className={styles.asideBlock}>
      <SectionHeader title="運用アラート" href="/emergency" linkLabel="運用状態を見る" />
      <p className={styles.alertHead}>
        <span className={failed || count === null ? styles.faintStrong : styles.strong}>
          {failed ? '未取得' : count === null ? '—' : `接続・自動処理 ${count}件`}
        </span>
        {!failed && count !== null ? <Tag tone={count > 0 ? 'warning' : 'success'}>{count > 0 ? '要確認' : '正常'}</Tag> : null}
      </p>
      <p className={styles.item}>{`・最も古い未対応：${oldestWaitMinutes === null ? '—' : formatWaitRough(oldestWaitMinutes)}`}</p>
      <p className={styles.item}>{`・組織全体の二段階認証：${twoFactor === null ? '—' : `${twoFactor.enabled} / ${twoFactor.total}人`}`}</p>
      <Updated>{dashboardLocalUpdatedAt(updatedAt)}</Updated>
    </div>
  )
}

/* ── 右の列：現在の対応状況 ───────────────────────── */
export function SupportStatus({ inbox, autoOnInbound }: { inbox: DashboardOverview['inbox'] | null; autoOnInbound: boolean | null }) {
  const rows = [
    { label: '未対応', value: inbox?.unanswered ?? null, href: '/chats?status=unread' },
    { label: '対応中', value: inbox?.inProgress ?? null, href: '/chats?status=in_progress' },
    { label: '保留', value: inbox?.onHold ?? null, href: '/chats?status=on_hold' },
    { label: '対応済み', value: inbox?.resolved ?? null, href: '/chats?status=resolved' },
  ]
  const autoText = `メッセージ受信時の自動変更：${autoOnInbound === null ? '—' : autoOnInbound ? '有効' : '無効'}`
  return (
    <div className={styles.asideBlock}>
      <SectionHeader
        title="現在の対応状況"
        help="現在の件数。選択中のアカウントのLINE（友だち単位）と、すべてのMAIL（メール単位）の合計。受信箱の絞り込みと同じ数。"
        helpLabel="現在の対応状況の説明"
        href="/chats"
        linkLabel="受信箱を見る"
      />
      {rows.map((row) => (
        <KeyValue
          key={row.label}
          label={row.label}
          value={row.value === null ? '—' : `${formatNumber(row.value)}件`}
          tone={row.label === '未対応' && (row.value ?? 0) > 0 ? 'danger' : 'default'}
          href={row.href}
          title={`${row.label}で絞った受信箱を開く`}
        />
      ))}
      <p className={styles.caption} title={autoText}>{autoText}</p>
    </div>
  )
}

/* ── 右の列：接続状態 ─────────────────────────────── */
export function ConnectionStatus({ webhook, risk, activeFriends, healthFailed }: {
  webhook: string | undefined
  risk: HealthRisk
  activeFriends: number | null
  healthFailed?: boolean
}) {
  const webhookLabel = webhook === 'matched' ? '正常' : webhook === 'mismatched' || webhook === 'unconfigured' ? '要確認' : '確認中'
  const autoLabel = healthFailed ? '未取得' : risk === 'normal' ? '稼働中' : risk ? '要確認' : '確認中'
  const dotOf = (label: string) => (label === '正常' || label === '稼働中' ? 'success' : label === '要確認' ? 'danger' : 'faint') as 'success' | 'danger' | 'faint'
  return (
    <div className={styles.asideBlock}>
      <SectionHeader title="接続状態" />
      <KeyValue label="LINE Webhook" value={webhookLabel} dot={dotOf(webhookLabel)} tone={webhookLabel === '要確認' ? 'danger' : 'default'} />
      <KeyValue label="自動処理" value={autoLabel} dot={dotOf(autoLabel)} tone={autoLabel === '要確認' ? 'danger' : 'default'} />
      <KeyValue label="有効友だち" value={activeFriends === null ? '—' : `${formatNumber(activeFriends)}人`} />
    </div>
  )
}

/* ── 右の列：友だちの状態 ─────────────────────────── */
export function FriendStatus({ friends }: { friends: DashboardOverview['friends'] }) {
  const blocked = friends.blockedByThem + friends.hiddenByUs + friends.blockedBoth
  const base = friends.active + blocked
  const rate = base > 0 ? (blocked / base) * 100 : 0
  return (
    <>
      <SectionHeader title="友だちの状態" note="現在" href="/friends" linkLabel="友だちを見る" />
      <KeyValue label="友だち総数" value={`${formatNumber(friends.total)}人`} />
      <KeyValue label="有効" value={`${formatNumber(friends.active)}人`} />
      <KeyValue label="ブロック・非表示" value={`${formatNumber(blocked)}人（${rate.toFixed(1)}%）`} />
      <p className={styles.small}>
        {`相手から ${formatNumber(friends.blockedByThem)}人・自分から ${formatNumber(friends.hiddenByUs)}人・相互に ${formatNumber(friends.blockedBoth)}人`}
      </p>
    </>
  )
}

/* ── 段D：今後の予定 ─────────────────────────────── */
const upcomingKindLabel: Record<string, string> = { broadcast: '配信', reminder: 'リマインダー', booking: '予約' }

/** 今日の予定は時刻だけ、違う日は日付を付ける（深夜に見て読み違えない）。 */
function upcomingTime(iso: string, today: string, jstDay: (v: string) => string): string {
  return jstDay(iso) === today ? formatTime(iso) : formatDateTime(iso)
}

export function Upcoming({ accountId, bookings, loading, today, jstDay, startLoad }: {
  accountId: string | null
  /** 本文の段が見えるまで取らない（速さ対応）。 */
  startLoad: boolean
  bookings: BookingRequest[] | null
  loading: boolean
  today: string
  jstDay: (v: string) => string
}) {
  const [upcoming, setUpcoming] = useState<DashboardUpcoming | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!startLoad || !accountId) return
    let cancelled = false
    setUpcoming(null)
    setFailed(false)
    void api.dashboard.upcoming(accountId)
      .then((response) => {
        if (cancelled) return
        if (response.success) setUpcoming(response.data)
        else setFailed(true)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [accountId, startLoad])

  const header = (
    <SectionHeader
      title="今後の予定"
      help="7日分の予約配信・リマインダー・予約です。見るだけで、ここからは変えられません。"
      helpLabel="今後の予定の説明"
      {...(upcoming ? {} : { href: '/booking/bookings?view=list', linkLabel: 'すべて見る' })}
    />
  )
  if (accountId && !failed && upcoming) {
    return (
      <>
        {header}
        {upcoming.items.length === 0 ? <p className={styles.note}>予定されている配信・予約はありません。</p> : upcoming.items.slice(0, 3).map((item) => (
          <div key={`${item.kind}-${item.id}`} className={styles.plan}>
            <span className={styles.planText}>
              <Link href={item.href} className={styles.planTitle} title={item.title}>{item.title}</Link>
              <span className={styles.planKind} title={upcomingKindLabel[item.kind] ?? '予定'}>{upcomingKindLabel[item.kind] ?? '予定'}</span>
            </span>
            <span className={styles.planTime}>{upcomingTime(item.startsAt, today, jstDay)}</span>
          </div>
        ))}
      </>
    )
  }
  /* 旧Worker（upcoming 未返却）・取得失敗のときは予約だけに戻る（v7 と同じ）。 */
  const legacy = bookings ? activeUpcomingBookings(bookings) : []
  const legacyLoading = accountId ? (!failed || loading) && bookings === null : loading
  return (
    <>
      {header}
      {legacyLoading ? <Loading label="今後の予定" /> : bookings === null ? (
        <p className={styles.note}>予定を読み込めませんでした。</p>
      ) : legacy.length === 0 ? (
        <p className={styles.note}>予定されている配信・予約はありません。</p>
      ) : legacy.slice(0, 3).map((booking) => (
        <div key={booking.id} className={styles.plan}>
          <span className={styles.planText}>
            <span className={styles.planTitle} title={booking.menu_name}>{booking.menu_name}</span>
            <span className={styles.planKind} title={booking.friend_name ?? '名前未設定'}>{booking.friend_name ?? '名前未設定'}</span>
          </span>
          <span className={styles.planTime}>{upcomingTime(booking.starts_at, today, jstDay)}</span>
        </div>
      ))}
    </>
  )
}

/* ── 段D：今日の配信の失敗 ───────────────────────── */
export function DeliveryFailures({ accountId, startLoad }: { accountId: string | null; startLoad: boolean }) {
  const [origins, setOrigins] = useState<DeliveryFailureOrigins | null>(null)
  const [failed, setFailed] = useState(false)
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null)
  useEffect(() => {
    if (!startLoad || !accountId) return
    let cancelled = false
    setOrigins(null)
    setFailed(false)
    setFetchedAt(null)
    void api.dashboard.deliveryFailureOrigins(accountId)
      .then((response) => {
        if (cancelled) return
        if (response.success) {
          setOrigins(response.data)
          setFetchedAt(new Date())
        } else setFailed(true)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [accountId, startLoad])
  const asOf = origins?.asOf ? formatDateTime(origins.asOf) : null
  return (
    <>
      <SectionHeader
        title="今日の配信の失敗"
        help={asOf
          ? `出どころ：通知の送達台帳・${asOf}時点。同じ失敗は1件として数えています（送り直しは数えません）。`
          : '出どころ：通知の送達台帳。同じ失敗は1件として数えています（送り直しは数えません）。'}
        helpLabel="今日の配信の失敗の説明"
      />
      {origins ? (
        <p className={styles.figure}><span className={styles.bigNum}>{formatNumber(origins.total)}</span><span className={styles.unit}>件</span></p>
      ) : failed ? (
        <p className={styles.figure}><span className={styles.bigNum}>—</span></p>
      ) : <Loading label="今日の配信の失敗" />}
      <p className={styles.note}>{failed ? '読み込めませんでした。' : '送れなかった理由と送り直しは、配信の詳細で確かめる'}</p>
      <Updated>{dashboardLocalUpdatedAt(fetchedAt)}</Updated>
    </>
  )
}

/* ── 段D：今月の配信 ─────────────────────────────── */
export function MonthlyDelivery({ delivery, section }: { delivery: DashboardOverview['delivery']; section?: Section }) {
  const fig = (label: string, value: number | null) => (
    <div className={styles.fig}>
      <span className={styles.figKey}>{label}</span>
      <span className={styles.figure}><span className={styles.midNum}>{value === null ? '—' : formatNumber(value)}</span><span className={styles.unitSmall}>通</span></span>
    </div>
  )
  return (
    <>
      <SectionHeader title="今月の配信" href="/analytics?tab=reactions" linkLabel="アクセス解析へ" />
      <div className={styles.figs}>{fig('プッシュ数', delivery.push)}{fig('リプライ数', delivery.reply)}</div>
      <Updated>{sectionUpdated(section)}</Updated>
    </>
  )
}

/* ── 段D：最近の成果 ─────────────────────────────── */
export function RecentResults({ conversions, period, section }: { conversions: DashboardOverview['conversions']; period: string; section?: Section }) {
  return (
    <>
      <SectionHeader title="最近の成果" note={period} href="/conversions" linkLabel="成果を見る" />
      {conversions.byPoint.length === 0 ? (
        <p className={styles.noteBody}>この期間の成果はまだありません。成果地点を作ると、ここに件数が出ます。</p>
      ) : (
        <>
          {conversions.byPoint.map((point) => (
            <KeyValue key={point.name} label={point.name} value={`${formatNumber(point.count)} 件`} />
          ))}
          <KeyValue label="合計" value={`${formatNumber(conversions.total)} 件`} />
        </>
      )}
      <Updated>{sectionUpdated(section)}</Updated>
    </>
  )
}

/* ── 数だけの段（編集で出せる追加のカード） ───────── */
export function Metric({ title, period, href, linkLabel, value, unit = '件', detail, help, section, loading }: {
  title: string
  period?: string
  href: string
  linkLabel: string
  value: number | null
  unit?: string
  detail: string
  help?: string
  section?: Section
  loading: boolean
}) {
  return (
    <>
      <SectionHeader title={title} note={period} help={help} helpLabel={help ? `${title}の説明` : undefined} href={href} linkLabel={linkLabel} />
      {loading && value === null ? <Loading label={title} /> : (
        <p className={styles.figure}><span className={styles.bigNum}>{value === null ? '—' : formatNumber(value)}</span>{value === null ? null : <span className={styles.unit}>{unit}</span>}</p>
      )}
      {detail ? <p className={styles.note}>{detail}</p> : null}
      <Updated>{sectionUpdated(section)}</Updated>
    </>
  )
}

/* ── 段E：最近の動き ─────────────────────────────── */
function activityIcon(item: NotificationCenterItem) {
  if (item.category === 'error') return TriangleAlert
  if (item.eventType.startsWith('broadcast')) return Send
  if (item.eventType.startsWith('friend')) return UserPlus
  return Bell
}

export function RecentActivity({ items, failed }: { items: NotificationCenterItem[] | null; failed: boolean }) {
  const shown = (items ?? []).slice(0, 3)
  return (
    <section className={styles.activity} aria-label="最近の動き">
      <SectionHeader title="最近の動き" href="/notifications" linkLabel="すべての動きを見る" />
      {items === null ? (
        failed ? <p className={styles.note}>最近の動きを読み込めませんでした。</p> : <Loading label="最近の動き" />
      ) : shown.length === 0 ? (
        <p className={styles.note}>最近の動きはありません。</p>
      ) : shown.map((item, index) => (
        <Link key={item.id} href={dashboardNotificationDestination(item)} className={styles.activityLink}>
          <ActivityItem
            icon={activityIcon(item)}
            title={item.title}
            note={item.body}
            time={formatRelative(item.createdAt)}
            last={index === shown.length - 1}
          />
        </Link>
      ))}
    </section>
  )
}
