'use client'

import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import { nextMonthResetLabel, type BannerUsage } from '@/lib/hq-banners'

/**
 * 上限に達した状態。Pencil 35-4 `oaFjL`（黄の帯・`$status-warn-soft`）。
 *
 * 数字は実際の値を出し、取れないときは「—」（推測で埋めない）。
 * 「課金プランを見る」は 36-2（/hq/billing）へ。上限と課金の停止のときだけ出す。
 */
export default function LimitState({ usage, onReload, compact }: { usage: BannerUsage | null; onReload?: () => void; compact?: boolean }) {
  const kind = !usage ? null : usage.blocked ? 'blocked' : usage.paused ? 'paused' : usage.month.remaining <= 0 ? 'month' : usage.today.remaining <= 0 ? 'today' : null
  if (!kind) return null
  const title =
    kind === 'blocked'
      ? usage?.planState === 'canceled' ? '契約が終了しているため、生成は止まっています' : '無料トライアルが終了したため、生成は止まっています'
      : kind === 'paused' ? '失敗が続いたため一時停止しています' : kind === 'month' ? '今月の生成上限に達しました' : '今日の生成上限に達しました'
  const body =
    kind === 'blocked'
      ? usage?.blockedReason ?? '課金プランからプランを選ぶと再開します。'
      : kind === 'paused'
      ? usage?.pausedReason ?? '15分ほど待ってから、もう一度お試しください。何度も続く場合はお問い合わせから知らせてください。'
      : kind === 'month'
        ? `今月の上限 ${usage?.month.limit ?? '—'}枚のうち ${usage?.month.used ?? '—'}枚を使いました。${nextMonthResetLabel()} に戻ります。`
        : `1日の上限 ${usage?.today.limit ?? '—'}枚のうち ${usage?.today.used ?? '—'}枚を使いました。明日以降にお試しください。`
  return (
    <Notice tone="warn" role="status" data-design-node="oaFjL" heading={title}
      data-limit-layout={compact ? 'compact' : 'full'}
      action={<>
        {kind === 'blocked' || kind === 'month' ? <Button href="/hq/billing">課金プランを見る</Button> : null}
        {onReload ? <Button onClick={onReload}>利用量を読み直す</Button> : null}
      </>}
    >{body}</Notice>
  )
}
