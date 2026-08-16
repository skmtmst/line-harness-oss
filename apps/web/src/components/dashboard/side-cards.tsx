import Link from 'next/link'
import type { ReactNode } from 'react'
import type { DashboardOverview } from '@/lib/api'

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
    <section className="bg-canvas rounded-card border-hairline border">
      <div className="border-hairline flex items-center justify-between border-b px-5 py-3.5">
        <h2 className="text-ink text-sm font-semibold">{title}</h2>
        <Link href={action.href} className="text-accent text-xs hover:underline">
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
  const handled = inbox.inProgress + inbox.resolved
  const total = inbox.unanswered + handled
  // 0件のときに 0/0 で NaN にしない。棒は空のまま出す。
  const ratio = total > 0 ? (inbox.unanswered / total) * 100 : 0

  return (
    <SideCard title="対応状況" action={{ label: '受信箱へ', href: '/chats' }}>
      <div className="space-y-3">
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-ink-secondary text-xs">未対応</span>
            <span className="text-ink text-sm font-bold tabular-nums">
              {inbox.unanswered.toLocaleString('ja-JP')} 人
            </span>
          </div>
          <div className="bg-canvas-sunken h-1.5 overflow-hidden rounded-full">
            <div className="bg-warning h-full rounded-full" style={{ width: `${ratio}%` }} />
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-ink-secondary text-xs">対応済</span>
            <span className="text-ink text-sm font-bold tabular-nums">
              {handled.toLocaleString('ja-JP')} 人
            </span>
          </div>
          <div className="bg-canvas-sunken h-1.5 overflow-hidden rounded-full">
            <div className="bg-success h-full rounded-full" style={{ width: `${100 - ratio}%` }} />
          </div>
        </div>
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

  return (
    <SideCard title="今月の配信" action={{ label: 'アクセス解析へ', href: '/analytics' }}>
      <div className="grid grid-cols-2 gap-4">
        {/*
          設計の「プッシュ数 / リプライ数」。LINEは自発の送信（プッシュ）と
          受信への応答（リプライ）で課金が違うので、まとめると枠の減りを
          読み違える。source（028）で分かれる。
        */}
        <Figure label="プッシュ数" value={delivery.push} unit="通" />
        <Figure label="リプライ数" value={delivery.reply} unit="通" />
        <div className="col-span-2">
          <p className="text-ink-faint text-xs">残枠</p>
          <p className="text-ink mt-0.5 text-lg font-bold tabular-nums">
            {remaining === null ? '—' : remaining.toLocaleString('ja-JP')}
            {delivery.quotaLimit !== null && (
              <span className="text-ink-secondary ml-1 text-xs font-normal">
                / {delivery.quotaLimit.toLocaleString('ja-JP')}
              </span>
            )}
          </p>
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
    <SideCard title="直近の成果" action={{ label: '成果を見る', href: '/conversions' }}>
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
