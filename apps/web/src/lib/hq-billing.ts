/**
 * 統括の課金（★V6 36-2）の型と小さな計算。API の形は `apps/worker/src/routes/hq-billing.ts` が正本。
 */

export type BillingState = 'exempt' | 'trialing' | 'active' | 'past_due' | 'trial_expired' | 'canceled'
export type PlanKey = 'light' | 'standard' | 'pro'

export interface BillingPlanView {
  key: PlanKey
  name: string
  description: string
  cta: 'checkout' | 'contact'
  monthlyYen: number
  priceFromStripe: boolean
  monthlyImages: number
  maxStaff: number | null
  features: string[]
  recommended: boolean
  /** Stripe の鍵と価格 ID がそろっていて申し込めるか。 */
  available: boolean
  current: boolean
}

export interface BillingSummary {
  state: BillingState
  planKey: PlanKey | null
  planName: string | null
  planStatus: 'exempt' | 'trialing' | 'active' | 'past_due' | 'canceled'
  trialEndsAt: string | null
  trialEndsLabel: string | null
  trialDaysLeft: number | null
  trialMonthlyImages: number
  currentPeriodEndsAt: string | null
  currentPeriodEndsLabel: string | null
  canSend: boolean
  canGenerate: boolean
  blockedReason: string | null
  dataRetentionDays: number
  stripeReady: boolean
  portalAvailable: boolean
  plans: BillingPlanView[]
}

export interface BillingInvoice {
  id: string
  number: string | null
  status: string | null
  amountYen: number
  currency: string
  createdAt: string
  description: string | null
  hostedUrl: string | null
  pdfUrl: string | null
}

/** 左下の札と 36-2 の帯に出す短い呼び名。 */
export function billingChip(summary: Pick<BillingSummary, 'state' | 'planName' | 'trialDaysLeft'>): { label: string; tone: 'warn' | 'ok' | 'danger' | 'neutral' } | null {
  switch (summary.state) {
    case 'trialing':
      return { label: '無料トライアル', tone: 'warn' }
    case 'active':
      return { label: summary.planName ?? '契約中', tone: 'ok' }
    case 'past_due':
      return { label: '支払いを確認中', tone: 'danger' }
    case 'trial_expired':
      return { label: 'トライアル終了', tone: 'danger' }
    case 'canceled':
      return { label: '契約終了', tone: 'neutral' }
    default:
      return null
  }
}

/** 「残り25日」。トライアル中だけ。 */
export function trialDaysLabel(summary: Pick<BillingSummary, 'state' | 'trialDaysLeft'>): string | null {
  if (summary.state !== 'trialing' || summary.trialDaysLeft === null) return null
  return `残り${summary.trialDaysLeft}日`
}

/** 契約状況の帯。見出し・本文・色。 */
export function billingBanner(summary: BillingSummary): { tone: 'info' | 'warn' | 'danger'; title: string; body: string } {
  const keep = `データは${summary.dataRetentionDays}日間保持されます。`
  switch (summary.state) {
    case 'exempt':
      return { tone: 'info', title: '課金の対象外です', body: 'この統括は運営用のため、料金はかかりません。プランの内容はここで確認できます。' }
    case 'trialing':
      return {
        tone: 'warn',
        title: `無料トライアル中（${summary.trialEndsLabel ?? '—'} まで・残り${summary.trialDaysLeft ?? '—'}日）`,
        body: `トライアル中はすべての機能を使えます。期限までにプランを選ぶと、そのまま使い続けられます。選ばなかった場合は配信と生成が止まり、${keep}`,
      }
    case 'active':
      return {
        tone: 'info',
        title: `${summary.planName ?? 'プラン'}を契約中${summary.currentPeriodEndsLabel ? `（次回の更新 ${summary.currentPeriodEndsLabel}）` : ''}`,
        body: 'プランの変更・支払い方法・解約は「支払い方法を管理」から行えます。',
      }
    case 'past_due':
      return {
        tone: 'danger',
        title: '支払いを確認できていません',
        body: 'カードの期限切れなどで引き落としができていません。「支払い方法を管理」から更新してください。確認できるまで機能は止めません。',
      }
    case 'trial_expired':
      return { tone: 'danger', title: '無料トライアルが終了しました', body: `配信とバナー生成が止まっています。プランを選ぶとすぐ再開します。${keep}` }
    case 'canceled':
      return { tone: 'danger', title: '契約が終了しています', body: `配信とバナー生成が止まっています。プランを選ぶとすぐ再開します。${keep}` }
  }
}

export function yen(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`
}

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  paid: '支払い済み',
  open: '未払い',
  draft: '下書きの請求',
  void: '取り消し',
  uncollectible: '回収不能',
}
