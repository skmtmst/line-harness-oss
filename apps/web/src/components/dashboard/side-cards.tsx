import Link from 'next/link'
import type { ReactNode } from 'react'
import type { BookingRequest, DashboardOverview } from '@/lib/api'
import Card from '@/components/shared/card'
import { HelpTip } from '@/components/dashboard/help-tip'

/**
 * 右カラムのカード。
 *
 * 設計（`Right`）は「見出し ＋ 右上のリンク ＋ 中身」という同じ形が並ぶ。
 * 枠だけ共通にして、中身はカードごとに書く。
 */
/**
 * ダッシュボードの右カラム以外のカード（送信枠・運用アラート）でも使う。
 * 行き先リンクは見出しの行の右端に1つ、更新時刻は右下にそろえる。
 */
export function SideCard({
  title,
  period,
  helpTip,
  action,
  freshness,
  children,
}: {
  title: string
  /*
   * 数字の対象期間。「今月」「直近7日」など、見出しの脇に小さく添える
   * （IDEA-01: カードの数字がいつの範囲かを読めるようにする）。
   * 題と合わせて1行に収まらないときは、脇に置かず HelpTip へ移す。
   */
  period?: string
  /*
   * 「？」に入れる補足（いつ元に戻るかなど）。題の脇をふさがない。
   * period と両方は置かない。
   */
  helpTip?: string
  /** 設計に右上のリンクが無いカードもある（現在の対応状況）。 */
  action?: { label: string; href: string }
  /** 更新時刻・取得失敗などの鮮度表示。カードの末尾右寄せで出す。 */
  freshness?: ReactNode
  children: ReactNode
}) {
  return (
    <Card padding="roomy">
      <div className="flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-ink min-w-0 text-base leading-normal font-bold">{title}</h2>
          {helpTip ? <HelpTip text={helpTip} /> : null}
          {/* 期間は常に1行にする（DASH-23）。折り返すとカード間で見出しの高さがずれる。 */}
          {period ? <span className="text-ink-faint flex-1 pt-0.5 text-[11px] font-normal whitespace-nowrap">{period}</span> : null}
          {/*
            行き先リンクは CardHeader の action（actionTone="info"）と
            同じ見た目にする。ダッシュボードの行き先リンクはこの1つに
            そろえ、独自の色・大きさを増やさない。
          */}
          {action ? <Link href={action.href} className="text-status-info shrink-0 text-label font-semibold hover:underline">{action.label}</Link> : null}
        </div>
        <div>{children}</div>
        {freshness ? <div className="flex justify-end">{freshness}</div> : null}
      </div>
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

/**
 * 今月の配信。**送信枠はここに出さない。**
 *
 * 以前はここにも「送信枠 3 / 200・残り98.5%」の帯を置いていた。右上の
 * 「今月の送信枠」と**同じ数を2回**描くことになり、片方を見て片方を
 * 見落とす。設計（`vUXKb`）でも枠は上の1枚だけ。
 */
export function MonthlyDeliveryCard({ delivery, freshness }: { delivery: DashboardOverview['delivery']; freshness?: ReactNode }) {
  return (
    /*
      「配信の反応」タブが同じ母集団（プッシュ・リプライの送信数）を見る画面。
      既定タブの「友だちの増減」へ落とすと、カードの数字と遷移先の数字が
      一致しない（IDEA-01）。
    */
    <SideCard title="今月の配信" action={{ label: 'アクセス解析へ →', href: '/analytics?tab=reactions' }} freshness={freshness}>
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
 * 現在の対応状況（設計 `vUXKb` の右カラム）。
 *
 * 4つの状態は `/api/dashboard/overview` の `inbox` から出る。数え方は
 * 受信箱の絞り込みと同じ定義・同じ範囲（`getInboxStatusCounts` が正本で、
 * ダッシュボードと受信箱が同じ関数を通る）。MAIL の未対応が入らない・
 * 対応中と保留が出ない、というずれを直した形。
 * 「メッセージ受信時の自動変更」は、選択中のLINEアカウントの
 * 対応マーク一覧を読み、1件でも自動変更があれば「有効」とする。
 * **「対応マーク」は自由分類のほう。**このカードが並べる4状態は
 * 固定4状態の「対応状況」で、別物（要件書 `v6-02-inbox-requirements-draft.md:77`）。
 * 一覧を取得できなかったときだけ `—`（未取得）にする。
 */
export function SupportMarkStatusCard({
  inbox,
  autoOnInbound,
  freshness,
}: {
  inbox: DashboardOverview['inbox'] | null
  /** 受信時の自動変更が入っているか。取れないときは null。 */
  autoOnInbound: boolean | null
  freshness?: ReactNode
}) {
  return (
    /*
      件数は受信箱の絞り込みと同じもの。各状態を押すと、その状態で
      絞った受信箱を開く（IDEA-01）。単位は受信箱に合わせて「件」。
    */
    <SideCard
      title="現在の対応状況"
      helpTip="現在の件数。選択中のアカウントのLINE（友だち単位）と、すべてのMAIL（メール単位）の合計。受信箱の絞り込みと同じ数。"
      action={{ label: '受信箱を見る →', href: '/chats' }}
      freshness={freshness}
    >
      {/*
        4状態は2×2に並べる（未対応・対応中／保留・対応済み）。1行に4つ並べると
        狭い右カラムで「対応済み」だけ下へ落ちる。数は右端にそろえ、桁が
        ずれても位が合うよう等幅数字にする。
      */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        {[
          { label: '未対応', value: inbox?.unanswered ?? null, href: '/chats?status=unread' },
          { label: '対応中', value: inbox?.inProgress ?? null, href: '/chats?status=in_progress' },
          // 段階配備中の旧Workerは保留を返さない。その間は「—」にし、0件と見せない。
          { label: '保留', value: inbox?.onHold ?? null, href: '/chats?status=on_hold' },
          { label: '対応済み', value: inbox?.resolved ?? null, href: '/chats?status=resolved' },
        ].map((row) => (
          <Link
            key={row.label}
            href={row.href}
            title={`${row.label}で絞った受信箱を開く`}
            className={`${row.label === '未対応' && (row.value ?? 0) > 0 ? 'text-danger' : 'text-ink'} flex items-baseline justify-between gap-3 text-sm font-bold hover:underline`}
          >
            <span className="min-w-0 truncate">{row.label}</span>
            <span className="shrink-0 tabular-nums">
              {row.value === null ? '—' : `${row.value.toLocaleString('ja-JP')}件`}
            </span>
          </Link>
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
  period,
  freshness,
}: {
  conversions: DashboardOverview['conversions']
  /** 選択中の集計期間（今日・過去7日・過去28日）。カードの件数と同じ範囲を示す。 */
  period: string
  freshness?: ReactNode
}) {
  return (
    <SideCard title="最近の成果" period={period} action={{ label: '成果を見る →', href: '/conversions' }} freshness={freshness}>
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

export const inactiveBookingStatuses = new Set(['rejected', 'cancelled', 'canceled', 'completed', 'no_show'])

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
  updatedAt,
}: {
  bookings: BookingRequest[] | null
  loading: boolean
  /* 明細を最後に取れた時刻。読込中・失敗時は出さない（IDEA-01）。 */
  updatedAt?: Date | null
}) {
  const upcoming = bookings ? activeUpcomingBookings(bookings) : []
  return (
    /*
      このカードが載せるのは予約だけ（DASH-10）。「今後の予定」「配信・予約は
      ありません」と書くと、配信が無いことにも読めてしまう。
      行き先は予約一覧（リスト表示）。カードに並ぶのは未来の予約なので、
      日カレンダーではなく一覧へ送る（IDEA-01）。
    */
    <SideCard
      title="今後の予約"
      period="今後"
      action={{ label: 'すべて見る →', href: '/booking/bookings?view=list' }}
      freshness={updatedAt ? <span className="text-ink-faint shrink-0 text-xs font-medium">更新 {updatedAt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })}</span> : undefined}
    >
      {loading ? (
        <div className="space-y-2">
          <div className="bg-canvas-sunken h-5 animate-pulse rounded" />
          <div className="bg-canvas-sunken h-5 animate-pulse rounded" />
        </div>
      ) : bookings === null ? (
        <p className="text-ink-faint text-xs leading-relaxed">予約を読み込めませんでした。</p>
      ) : upcoming.length === 0 ? (
        <p className="text-ink-faint text-xs leading-relaxed">今後の予約はありません。</p>
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

export function FriendStatusCard({ friends, freshness }: { friends: DashboardOverview['friends']; freshness?: ReactNode }) {
  const blocked = friends.blockedByThem + friends.hiddenByUs + friends.blockedBoth
  const base = friends.active + blocked
  const rate = base > 0 ? (blocked / base) * 100 : 0
  return (
    <SideCard title="友だちの状態" period="現在" action={{ label: '友だちを見る →', href: '/friends' }} freshness={freshness}>
      {/*
        設計（`vUXKb`）は「友だち総数 / 有効 / ブロック・非表示（率）」の3行と、
        その下に内訳。**総数と内訳が無いと、223人が誰から止められたのかが
        読めない**（相手からブロックされたのか、こちらで非表示にしたのか）。
      */}
      <dl className="space-y-2.5 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-secondary text-xs">友だち総数</dt>
          <dd className="text-ink font-bold tabular-nums">{friends.total.toLocaleString('ja-JP')}人</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-secondary text-xs">有効</dt>
          <dd className="text-ink font-bold tabular-nums">{friends.active.toLocaleString('ja-JP')}人</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-secondary text-xs">ブロック・非表示</dt>
          <dd className="text-ink font-bold tabular-nums">
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
