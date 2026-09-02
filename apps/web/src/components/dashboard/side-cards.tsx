import Link from 'next/link'
import type { ReactNode } from 'react'
import type { BookingRequest, DashboardOverview } from '@/lib/api'
import Card, { CardHeader } from '@/components/shared/card'

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
  /** 設計に右上のリンクが無いカードもある（現在の対応マーク）。 */
  action?: { label: string; href: string }
  children: ReactNode
}) {
  return (
    <Card overflow="hidden">
      <CardHeader
        size="roomy"
        title={title}
        action={action ? <Link href={action.href} className="hover:underline">{action.label}</Link> : undefined}
        actionTone="info"
      />
      <div className="p-5">{children}</div>
    </Card>
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

/**
 * 今月の配信。**送信枠はここに出さない。**
 *
 * 以前はここにも「送信枠 3 / 200・残り98.5%」の帯を置いていた。右上の
 * 「今月の送信枠」と**同じ数を2回**描くことになり、片方を見て片方を
 * 見落とす。設計（`vUXKb`）でも枠は上の1枚だけ。
 */
export function MonthlyDeliveryCard({ delivery }: { delivery: DashboardOverview['delivery'] }) {
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
      </div>
    </SideCard>
  )
}

/**
 * 現在の対応マーク（設計 `vUXKb` の右カラム）。
 *
 * 未対応と対応済みは `/api/dashboard/overview` の `inbox` から出る。
 * 「メッセージ受信時の自動変更」は、選択中のLINEアカウントの
 * 対応マーク一覧を読み、1件でも自動変更があれば「有効」とする。
 * 一覧を取得できなかったときだけ `—`（未取得）にする。
 */
export function SupportMarkStatusCard({
  inbox,
  autoOnInbound,
}: {
  inbox: DashboardOverview['inbox'] | null
  /** 受信時の自動変更が入っているか。取れないときは null。 */
  autoOnInbound: boolean | null
}) {
  return (
    <SideCard title="現在の対応マーク">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        {[
          { label: '未対応', value: inbox?.unanswered ?? null },
          { label: '対応済み', value: inbox?.resolved ?? null },
        ].map((row) => (
          <p key={row.label} className="text-success text-sm font-bold">
            {row.label}
            <span className="ml-1.5 tabular-nums">
              {row.value === null ? '—' : `${row.value.toLocaleString('ja-JP')}人`}
            </span>
          </p>
        ))}
      </div>
      <p className="text-ink-secondary mt-3 text-xs">
        メッセージ受信時の自動変更：
        {autoOnInbound === null ? '—' : autoOnInbound ? '有効' : '無効'}
      </p>
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
        <p className="text-ink-faint text-xs leading-relaxed">予定されている配信・予約はありません。</p>
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
      {/*
        設計（`vUXKb`）は「友だち総数 / 有効 / ブロック・非表示（率）」の3行と、
        その下に内訳。**総数と内訳が無いと、223人が誰から止められたのかが
        読めない**（相手からブロックされたのか、こちらで非表示にしたのか）。
      */}
      <dl className="space-y-2.5 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-secondary text-xs">友だち総数</dt>
          <dd className="text-success font-bold tabular-nums">{friends.total.toLocaleString('ja-JP')}人</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-secondary text-xs">有効</dt>
          <dd className="text-success font-bold tabular-nums">{friends.active.toLocaleString('ja-JP')}人</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-secondary text-xs">ブロック・非表示</dt>
          <dd className="text-success font-bold tabular-nums">
            {blocked.toLocaleString('ja-JP')}人（{rate.toFixed(1)}%）
          </dd>
        </div>
      </dl>
      <p className="text-ink-faint mt-3 text-[11px] leading-relaxed">
        内訳 相手から{friends.blockedByThem.toLocaleString('ja-JP')}人
        ・自分から{friends.hiddenByUs.toLocaleString('ja-JP')}人
        ・相互に{friends.blockedBoth.toLocaleString('ja-JP')}人
      </p>
    </SideCard>
  )
}
