import Link from 'next/link'
import type { ReactNode } from 'react'
import type { BookingRequest, DashboardOverview } from '@/lib/api'

/**
 * 右カラムのカード。
 *
 * 設計（`Right`）は「見出し ＋ 右上のリンク ＋ 中身」という同じ形が並ぶ。
 * 枠だけ共通にして、中身はカードごとに書く。
 */
function SideCard({
  title,
  action,
  children,
}: {
  title: string
  action: { label: string; href: string }
  children: ReactNode
}) {
  return (
    <section className="bg-canvas rounded-card border-hairline border shadow-[1px_2px_0_rgba(26,28,26,0.10)]">
      <div className="border-hairline flex items-center justify-between border-b px-5 py-3.5">
        <h2 className="text-ink text-sm font-semibold">{title}</h2>
        <Link href={action.href} className="text-action text-xs hover:underline">
          {action.label}
        </Link>
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

/** 数と単位を1行で。取れないものは「—」。 */
function Figure({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div>
      <p className="text-ink-faint text-xs">{label}</p>
      <p className="text-ink mt-0.5 text-lg font-bold tabular-nums">
        {value === null ? '—' : value.toLocaleString('ja-JP')}
        <span className="text-ink-secondary ml-1 text-xs font-normal">{unit}</span>
      </p>
    </div>
  )
}

export function InboxStatusCard({ inbox }: { inbox: DashboardOverview['inbox'] }) {
  /*
    設計は「未対応 / 対応中 / 対応済」の3本。
    以前は対応中と対応済を足して「対応済」1本にしていたので、
    **手をつけたが終わっていないもの（対応中）が画面から消えていた。**
    未対応が減っても、それが片付いたのか手をつけただけなのかが読めない。
  */
  const rows = [
    { label: '未対応', value: inbox.unanswered, bar: 'bg-warning' },
    { label: '対応中', value: inbox.inProgress, bar: 'bg-info' },
    { label: '対応済', value: inbox.resolved, bar: 'bg-success' },
  ]
  const total = rows.reduce((sum, r) => sum + r.value, 0)

  return (
    <SideCard title="対応状況" action={{ label: '受信箱へ', href: '/chats' }}>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-ink-secondary text-xs">{r.label}</span>
              <span className="text-ink text-sm font-bold tabular-nums">
                {r.value.toLocaleString('ja-JP')} 人
              </span>
            </div>
            <div className="bg-canvas-sunken h-1.5 overflow-hidden rounded-full">
              {/* 0件のときに 0/0 で NaN にしない。棒は空のまま出す。 */}
              <div
                className={`${r.bar} h-full rounded-full`}
                style={{ width: total > 0 ? `${(r.value / total) * 100}%` : '0%' }}
              />
            </div>
          </div>
        ))}
        <div className="border-hairline border-t pt-3">
          {/*
            設計の「平均の初回返信」。107 で受信と初回返信の時刻を残す
            ようにしたので出せるようになった。当てた日より前の往復は
            記録が無いため平均に入らない。
          */}
          <Figure
            label="平均の初回返信"
            value={inbox.averageFirstReplyMinutes}
            unit="分"
          />
          <div className="mt-2">
            <Figure
              label="最も古い未対応"
              value={inbox.oldestUnansweredMinutes}
              unit="分前"
            />
          </div>
        </div>
      </div>
    </SideCard>
  )
}

export function MonthlyDeliveryCard({ delivery }: { delivery: DashboardOverview['delivery'] }) {
  const remaining =
    delivery.quotaLimit !== null && delivery.quotaUsed !== null
      ? delivery.quotaLimit - delivery.quotaUsed
      : null
  const remainingPercent =
    remaining !== null && delivery.quotaLimit && delivery.quotaLimit > 0
      ? Math.max(0, (remaining / delivery.quotaLimit) * 100)
      : null

  return (
    <SideCard title="今月の配信" action={{ label: 'アクセス解析へ →', href: '/analytics' }}>
      <div className="grid grid-cols-2 gap-4">
        {/*
          設計の「プッシュ数 / リプライ数」。LINEは自発の送信（プッシュ）と
          受信への応答（リプライ）で課金が違うので、まとめると枠の減りを
          読み違える。source（028）で分かれる。
        */}
        <Figure label="プッシュ数" value={delivery.push} unit="通" />
        <Figure label="リプライ数" value={delivery.reply} unit="通" />
        <div className="col-span-2 border-hairline border-t pt-3">
          <p className="text-ink-faint text-xs">送信枠</p>
          <p className="text-ink mt-0.5 text-lg font-bold tabular-nums">
            {delivery.quotaUsed === null ? '—' : delivery.quotaUsed.toLocaleString('ja-JP')}
            {delivery.quotaLimit !== null && (
              <span className="text-ink-secondary ml-1 text-xs font-normal">
                / {delivery.quotaLimit.toLocaleString('ja-JP')}
              </span>
            )}
          </p>
          {remainingPercent !== null && (
            <>
              <div className="bg-canvas-sunken mt-2 h-1.5 overflow-hidden rounded-full">
                <div className="bg-accent h-full rounded-full" style={{ width: `${Math.min(100, remainingPercent)}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-[11px]">
                <span className="text-success font-medium">残り {remainingPercent.toFixed(1)}%</span>
                <Link href="/accounts" className="text-action hover:underline">配信設定へ →</Link>
              </div>
            </>
          )}
          {remaining === null && (
            <p className="text-ink-faint mt-1 text-[11px] leading-relaxed">
              LINE から送信枠を取得できませんでした。アクセストークンの設定を確認してください。
            </p>
          )}
        </div>
      </div>
    </SideCard>
  )
}

export function RecentResultsCard({
  conversions,
}: {
  conversions: DashboardOverview['conversions']
}) {
  return (
    <SideCard title="最近の成果" action={{ label: '成果を見る →', href: '/conversions' }}>
      {conversions.byPoint.length === 0 ? (
        <p className="text-ink-faint text-xs leading-relaxed">
          この期間の成果はまだありません。成果地点を作ると、ここに件数が出ます。
        </p>
      ) : (
        <div className="space-y-2.5">
          {conversions.byPoint.map((point) => (
            <div key={point.name} className="flex items-baseline justify-between gap-3">
              <span className="text-ink-secondary truncate text-xs">{point.name}</span>
              <span className="text-ink shrink-0 text-sm font-bold tabular-nums">
                {point.count.toLocaleString('ja-JP')} 件
              </span>
            </div>
          ))}
          <div className="border-hairline flex items-baseline justify-between border-t pt-2.5">
            <span className="text-ink-secondary text-xs">合計</span>
            <span className="text-ink text-sm font-bold tabular-nums">
              {conversions.total.toLocaleString('ja-JP')} 件
            </span>
          </div>
        </div>
      )}
    </SideCard>
  )
}

const inactiveBookingStatuses = new Set(['rejected', 'cancelled', 'canceled', 'completed', 'no_show'])

export function activeUpcomingBookings(bookings: BookingRequest[], now = Date.now()): BookingRequest[] {
  return bookings
    .filter((booking) => {
      const startsAt = new Date(booking.starts_at).getTime()
      return Number.isFinite(startsAt) && startsAt >= now && !inactiveBookingStatuses.has(booking.status)
    })
    .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime())
}

function formatUpcomingDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

export function UpcomingCard({
  bookings,
  loading,
}: {
  bookings: BookingRequest[] | null
  loading: boolean
}) {
  const upcoming = bookings ? activeUpcomingBookings(bookings) : []
  return (
    <SideCard title="今後の予定" action={{ label: 'すべて見る →', href: '/booking/bookings' }}>
      {loading ? (
        <div className="space-y-2">
          <div className="bg-canvas-sunken h-5 animate-pulse rounded" />
          <div className="bg-canvas-sunken h-5 animate-pulse rounded" />
        </div>
      ) : bookings === null ? (
        <p className="text-ink-faint text-xs leading-relaxed">予定を読み込めませんでした。</p>
      ) : upcoming.length === 0 ? (
        <p className="text-ink-faint text-xs leading-relaxed">予定されている予約はありません。</p>
      ) : (
        <div className="space-y-3">
          {upcoming.slice(0, 3).map((booking) => (
            <div key={booking.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-ink truncate text-xs font-medium" title={booking.menu_name}>{booking.menu_name}</p>
                <p className="text-ink-faint mt-0.5 truncate text-[11px]" title={booking.friend_name ?? undefined}>
                  {booking.friend_name ?? '名前未設定'}
                </p>
              </div>
              <span className="text-ink-secondary shrink-0 text-[11px] tabular-nums">{formatUpcomingDate(booking.starts_at)}</span>
            </div>
          ))}
        </div>
      )}
    </SideCard>
  )
}

export function FriendStatusCard({ friends }: { friends: DashboardOverview['friends'] }) {
  const blocked = friends.blockedByThem + friends.hiddenByUs + friends.blockedBoth
  const base = friends.active + blocked
  const rate = base > 0 ? (blocked / base) * 100 : 0
  return (
    <SideCard title="友だちの状態" action={{ label: '友だちを見る →', href: '/friends' }}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        <Figure label="有効友だち" value={friends.active} unit="人" />
        <Figure label="ブロック・非表示" value={blocked} unit="人" />
        <div className="col-span-2">
          <p className="text-ink-faint text-xs">ブロック率</p>
          <p className="text-ink mt-0.5 text-lg font-bold tabular-nums">{rate.toFixed(1)}<span className="text-ink-secondary ml-1 text-xs font-normal">%</span></p>
        </div>
      </div>
    </SideCard>
  )
}
