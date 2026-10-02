import { Check } from 'lucide-react'
import type { ApiBroadcast, BroadcastApprovalState, BroadcastDisplayStatus, BroadcastLedger } from '@/lib/api'

/**
 * 承認が絡む配信か（段に「承認待ち」を出す条件）。
 *
 * 承認を通った（approved）・頼んだ（pending）・期限切れなど、記録に残る
 * ものは絡む。承認の要らない配信（none・未設定）は出さない。
 * 配信本体の field が古い応答で無いときは、承認の今の状態で補う。
 */
export function isApprovalInvolved(
  broadcastApprovalStatus: ApiBroadcast['approvalStatus'],
  approval: BroadcastApprovalState | null,
): boolean {
  if (broadcastApprovalStatus != null && broadcastApprovalStatus !== 'none') return true
  return approval != null && approval.approval.status !== 'none'
}
import Chip from '@/components/shared/chip'
import HelpTip from '@/components/shared/help-tip'
import { formatNumber } from '@/lib/format'

export type StatusRailStatus = BroadcastDisplayStatus

const MAIN_STEPS = [
  { key: 'draft', label: '下書き' },
  { key: 'pending_approval', label: '承認待ち' },
  { key: 'scheduled', label: '予約済み' },
  { key: 'preparing', label: '送信準備' },
  { key: 'sending', label: '送信中' },
  { key: 'sent', label: '送信済み' },
] as const

type StepKey = (typeof MAIN_STEPS)[number]['key']

/**
 * 終わった状態（送り終わり・分かれ道の確定）。
 * 終わった段に「いまいる所」の輪は出さない。途中の時だけ輪を出す
 * （設計 C-1・共通の手順の決まり）。
 */
const FINISHED: ReadonlySet<StatusRailStatus> = new Set([
  'sent',
  'partial_failed',
  'failed',
  'stopped',
  'expired',
])

const BRANCH_LABELS: Partial<Record<StatusRailStatus, string>> = {
  partial_failed: '一部失敗',
  failed: '失敗',
  stopped: '停止',
  expired: '期限切れ',
}

/**
 * 状態の段（C-1）。配信の詳細の上に置く。
 *
 * 主な流れ（下書き→承認待ち→予約済み→送信準備→送信中→送信済み）を1列の
 * 段で見せ、いまどこかを1段の帯で言う。分かれ道（一部失敗・失敗・停止・
 * 期限切れ）は札で出す。承認がいらない配信・予約しない配信の段は出さない。
 */
export default function BroadcastStatusRail({
  displayStatus,
  approvalInvolved,
  scheduled,
  ledger,
  total,
  formatDateTime,
  scheduledAt,
}: {
  displayStatus: StatusRailStatus
  /** 承認が絡む配信（頼んだ・決まった・期限切れ）か。絡まない段は出さない。 */
  approvalInvolved: boolean
  /** 予約する配信か。予約しない即時配信の段は出さない。 */
  scheduled: boolean
  ledger: BroadcastLedger | null
  total: number
  formatDateTime: (value: string | null | undefined) => string
  scheduledAt: string | null | undefined
}) {
  const steps = MAIN_STEPS.filter((step) => {
    if (step.key === 'pending_approval') return approvalInvolved
    if (step.key === 'scheduled') return scheduled
    return true
  })
  const order: StepKey[] = steps.map((step) => step.key)
  // 分かれ道は、枝分かれする前の段までを済みとして見せる。
  const progressKey: StepKey =
    displayStatus === 'partial_failed' || displayStatus === 'failed' ? 'sent'
    : displayStatus === 'stopped' ? 'sending'
    : displayStatus === 'expired' ? (approvalInvolved ? 'pending_approval' : 'draft')
    : displayStatus
  const currentIndex = Math.max(0, order.indexOf(progressKey))
  const branchLabel = BRANCH_LABELS[displayStatus]
  // 終わった状態は着いた段までを済み（✓）にし、輪はどこにも出さない。
  const finished = FINISHED.has(displayStatus)

  return (
    <section aria-label="配信の状態" className="bg-canvas rounded-card border-hairline border p-5">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {steps.map((step, index) => {
          const done = finished ? index <= currentIndex : index < currentIndex
          const current = !finished && index === currentIndex
          return (
            <li key={step.key} className="flex items-center gap-2">
              {index > 0 ? <span aria-hidden="true" className="bg-hairline h-px w-6" /> : null}
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 items-center justify-center rounded-pill border text-micro ${done ? 'border-accent-deep bg-accent-soft text-accent-deep' : current ? 'border-accent-deep text-accent-deep' : 'border-hairline text-ink-faint'}`}
                >
                  {done ? <Check size={12} strokeWidth={3} /> : null}
                </span>
                <span
                  aria-current={current ? 'step' : undefined}
                  className={current ? 'text-ink text-sm font-medium' : 'text-ink-faint text-xs'}
                >
                  {step.label}
                </span>
              </span>
            </li>
          )
        })}
        {branchLabel ? (
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="bg-hairline h-px w-6" />
            <Chip tone={displayStatus === 'failed' ? 'danger' : displayStatus === 'partial_failed' ? 'warn' : 'neutral'}>
              {branchLabel}
            </Chip>
          </li>
        ) : null}
      </ol>
      <p className="bg-info-bg text-ink-secondary mt-3 rounded-control px-3 py-2 text-xs leading-relaxed">
        {bandText(displayStatus, ledger, total, scheduledAt, formatDateTime)}
      </p>
      {displayStatus === 'partial_failed' || displayStatus === 'failed' ? (
        <p className="mt-2 text-xs">
          <HelpTip label="失敗の内訳の説明">
            一時的な失敗（混み合いなど）は送り直せます。届けられなかった相手（ブロック・友だち解除など）は送り直しません。
          </HelpTip>
          <span className="text-ink-faint ml-1">失敗の内訳について</span>
        </p>
      ) : null}
    </section>
  )
}

function bandText(
  displayStatus: StatusRailStatus,
  ledger: BroadcastLedger | null,
  total: number,
  scheduledAt: string | null | undefined,
  formatDateTime: (value: string | null | undefined) => string,
): string {
  const sent = ledger?.sent ?? 0
  const totalText = formatNumber(total)
  switch (displayStatus) {
    case 'draft':
      return 'まだ送っていません'
    case 'pending_approval':
      return '承認されるまで送られません'
    case 'scheduled':
      return scheduledAt ? `${formatDateTime(scheduledAt)} に送り始めます` : '予約した時刻に送り始めます'
    case 'preparing':
      return '送信の準備をしています'
    case 'sending': {
      const remaining = Math.max(0, total - sent)
      return `送信中 ${formatNumber(sent)} / ${totalText}人に送りました。止めると、まだの${formatNumber(remaining)}人には送りません。`
    }
    case 'sent':
      return `${formatNumber(sent)} / ${totalText}人に届きました`
    case 'partial_failed': {
      const retryable = ledger?.retryableCount ?? 0
      return `${formatNumber(sent)} / ${totalText}人に届きました。${formatNumber(retryable)}人は送り直せます。`
    }
    case 'failed': {
      const retryable = ledger?.retryableCount ?? 0
      return retryable > 0
        ? `届けられませんでした。一時的な失敗 ${formatNumber(retryable)}人は送り直せます。`
        : '届けられませんでした。送り直せる相手はいません。'
    }
    case 'stopped':
      return '送信を止めました。まだの人には送っていません。'
    case 'expired':
      return '期限切れです。送るには作り直してください。'
  }
}
