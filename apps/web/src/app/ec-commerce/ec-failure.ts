import type { EcFailureKind, EcOrderDetailEvent } from '@/lib/api'

/*
 * IDEA-23: 失敗・見送りの分類を運用の言葉で出す。分類そのものは worker の
 * 台帳が error_code / 生メッセージから確定し、ここは表示語と次の行動だけ。
 * 「未連携／権限不足／通信失敗を分ける」完了条件に対応する。
 */
export const FAILURE_KIND_TEXT: Record<EcFailureKind, { label: string; hint: string }> = {
  unlinked: {
    label: '未連携',
    hint: 'LINEの友だちが見つかりません。「会員のつき合わせ」で結びつけると次回以降に届きます。',
  },
  not_following: {
    label: 'フォロー外',
    hint: '結びついた友だちが現在フォローしていないため送れません。再フォロー後にやり直せます。',
  },
  permission: {
    label: '権限・認証',
    hint: 'LINE連携の認証やアカウント設定を確認してください。「つなぎ先」タブで接続を確かめられます。',
  },
  communication: {
    label: '通信の失敗',
    hint: '一時的な通信の失敗です。自動で再試行する分と、「もう一度やる」で戻せる分があります。',
  },
  rejected: {
    label: '送信の拒否',
    hint: '送信内容または宛先が拒否されました。宛先の友だちの状態を確認してください。',
  },
  by_setting: {
    label: '設定で停止',
    hint: 'この通知は設定で止まっています。送るには通知の定義を公開状態にしてください。',
  },
  internal: {
    label: '処理の失敗',
    hint: '内部の処理が失敗しました。「もう一度やる」で同じ処理だけをやり直せます。',
  },
}

/* 届いた出来事1件の状態表示。 */
export const EVENT_STATUS_TEXT: Record<string, { label: string; tone: 'good' | 'warn' | 'danger' | 'muted' }> = {
  received: { label: '受け付けた', tone: 'warn' },
  identity_pending: { label: '未連携', tone: 'danger' },
  processing: { label: '処理中', tone: 'warn' },
  processed: { label: '処理済み', tone: 'good' },
  skipped: { label: '見送り', tone: 'muted' },
  failed: { label: '失敗', tone: 'danger' },
}

/*
 * 出来事がどの段階で止まったか。台帳の error_code と購読先別の配送結果から
 * 運用の段階名へ寄せる。正常終了・処理中は null を返す。
 */
export function eventStoppedStage(event: EcOrderDetailEvent): string | null {
  const action = event.actions[0]
  const code = action?.errorCode ?? null
  if (code === 'read_model_failed') return '注文情報の取り込み'
  if (code === 'line_identity_unmatched') return '友だちとの結びつき'
  if (code === 'friend_not_following') return '宛先の状態確認'
  if (code === 'notification_disabled') return '通知の設定'
  if (event.dispatches.some((dispatch) => dispatch.subscriber === 'notification' && dispatch.status === 'failed')) {
    return 'お客様への通知送信'
  }
  if (event.dispatches.some((dispatch) => dispatch.subscriber === 'v6' && dispatch.status === 'failed')) {
    return '自動化・スコアへの反映'
  }
  if (action && (action.status === 'retryable_failed' || action.status === 'permanent_failed')) {
    return '通知・連携の処理'
  }
  if (event.status === 'failed') return '出来事の処理'
  return null
}

/* 共通送信台帳の送達状態。 */
export const DELIVERY_STATUS_TEXT: Record<string, string> = {
  pending: '送信待ち',
  provider_accepted: '送信済み',
  excluded: '対象外',
  retry_wait: '再試行待ち',
  failed: '失敗',
}

/* 発送後の案内（nen_delivery_jobs）の見送り理由。台帳の既知コードだけに対応。 */
export const FOLLOWUP_REASON_TEXT: Record<string, string> = {
  order_cancelled: '注文の取り消しのため見送り',
  order_refunded: '返金のため見送り',
  friend_unavailable: '友だちが見つからないため見送り',
  line_account_unavailable: 'LINEアカウント設定の確認が必要',
  line_account_mismatch: 'アカウントの所属が変わったため見送り',
  campaign_snapshot_missing: '案内の設定情報が見つからないため見送り',
  campaign_disabled: '案内の設定が止まっているため見送り',
  campaign_form_already_submitted: 'フォーム回答済みのため見送り',
  frequency_suppressed: '連続送信の抑止で見送り',
}

export const FOLLOWUP_STATUS_TEXT: Record<string, { label: string; tone: 'good' | 'warn' | 'danger' | 'muted' }> = {
  pending: { label: '予約中', tone: 'warn' },
  processing: { label: '送信中', tone: 'warn' },
  sent: { label: '送信済み', tone: 'good' },
  skipped: { label: '見送り', tone: 'muted' },
  failed: { label: '失敗', tone: 'danger' },
  cancelled: { label: '取り消し済み', tone: 'muted' },
}
