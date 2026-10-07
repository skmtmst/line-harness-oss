'use client'

import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import { nextMonthResetLabel, type BannerUsage } from '@/lib/hq-banners'

export type BannerLimitKind = 'blocked' | 'paused' | 'month' | 'today'

/** 止まっている理由（v7 の limit-state と同じ判定）。止まっていなければ null。 */
export function bannerLimitKind(usage: BannerUsage | null): BannerLimitKind | null {
  if (!usage) return null
  if (usage.blocked) return 'blocked'
  if (usage.paused) return 'paused'
  if (usage.month.remaining <= 0) return 'month'
  if (usage.today.remaining <= 0) return 'today'
  return null
}

/** 題と本文（v7 と同じ文）。数が取れないときは「—」。 */
export function bannerLimitWords(usage: BannerUsage | null): { kind: BannerLimitKind; title: string; body: string } | null {
  const kind = bannerLimitKind(usage)
  if (!kind || !usage) return null
  const title =
    kind === 'blocked'
      ? usage.planState === 'canceled' ? '契約が終了しているため、生成は止まっています' : '無料トライアルが終了したため、生成は止まっています'
      : kind === 'paused' ? '失敗が続いたため一時停止しています' : kind === 'month' ? `今月の生成上限（${usage.month.limit}枚）に達しました` : '今日の生成上限に達しました'
  const body =
    kind === 'blocked'
      ? usage.blockedReason ?? '課金プランからプランを選ぶと再開します。'
      : kind === 'paused'
        ? usage.pausedReason ?? '15分ほど待ってから、もう一度お試しください。何度も続く場合はお問い合わせから知らせてください。'
        : kind === 'month'
          ? `来月1日（${nextMonthResetLabel()}）に戻ります。急ぐときはプランを変えると、すぐに続けられます。`
          : `1日の上限 ${usage.today.limit}枚のうち ${usage.today.used}枚を使いました。明日以降にお試しください。`
  return { kind, title, body }
}

/** 一覧の上に出す、止まっているときの帯（止まっていなければ何も出さない）。 */
export default function BannerLimitNotice({ usage }: { usage: BannerUsage | null }) {
  const words = bannerLimitWords(usage)
  if (!words) return null
  return (
    <Notice
      tone="warn"
      message={`${words.title}。${words.body}`}
      action={words.kind === 'blocked' || words.kind === 'month' ? <Button href="/hq/billing">課金プランを見る</Button> : undefined}
    />
  )
}
