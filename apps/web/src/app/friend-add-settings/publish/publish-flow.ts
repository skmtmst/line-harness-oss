import type {
  FriendAddRoutingPublishResult,
  FriendAddRoutingValidation,
  FriendAddRoutingVersion,
} from '@line-crm/shared'
import { resendSuppressionText } from '../friend-add-text'

/**
 * 友だち追加時配信の公開（設計 `ec9vg` 最終確認 ／ `quhg6` 有効化完了）。
 *
 * 判断だけをここに集める。**押してよいか**と**何と書くか**は、
 * 画面の描き方と別に確かめられるようにする。
 */

/** 取得元が無い値。実値の0とは別。 */
export const NOT_AVAILABLE = '—（未取得）'

/**
 * 対象見込み。
 *
 * **公開前は `validation.estimatedAudienceCount` を使う。**
 * 公開後の返事を先取りしたり、設計の数字（214人）を置いたりしない。
 * `null` は「まだ数えられていない」であって0人ではない。
 */
export function audienceText(count: number | null | undefined): string {
  if (count === null || count === undefined) return NOT_AVAILABLE
  return `${count.toLocaleString('ja-JP')}人`
}

const CHECK_TONE = {
  passed: '確認済み',
  warning: '注意',
  failed: '直してください',
} as const

export function checkStatusText(status: FriendAddRoutingValidationCheckStatus): string {
  return CHECK_TONE[status]
}

export type FriendAddRoutingValidationCheckStatus =
  FriendAddRoutingValidation['checks'][number]['status']

/**
 * 公開してよいか。
 *
 * **3つがそろって初めて押せる。**
 * ① Workerが `canPublish` を立てている
 * ② 最後の試験が成功している（`lastTestStatus === 'succeeded'`）
 * ③ 送信中でない
 *
 * ②を画面で見ているのは、`canPublish` だけに頼ると
 * **試験していない下書きを公開できる形**になり得るため。引き継ぎの
 * 2番がこの2つを別々に要求している。
 */
export function canPublish(input: {
  validation: FriendAddRoutingValidation | null
  busy: boolean
}): boolean {
  const v = input.validation
  if (!v || input.busy) return false
  if (!v.canPublish) return false
  return v.lastTestStatus === 'succeeded'
}

/** 押せないときの理由。**押せないボタンを黙って出さない。** */
export function blockedReason(validation: FriendAddRoutingValidation | null): string | null {
  if (!validation) return '確認の結果をまだ読み込めていません。'
  if (validation.lastTestStatus === null) {
    return 'テスト送信がまだです。テスト送信が成功すると有効化できます。'
  }
  if (validation.lastTestStatus === 'failed') {
    return '最後のテスト送信が失敗しています。直してからもう一度テストしてください。'
  }
  if (!validation.canPublish) {
    const failed = validation.checks.filter((check) => check.status === 'failed')
    return failed.length > 0
      ? `${failed.map((check) => check.label).join('・')}を直してください。`
      : '確認が終わっていない項目があります。'
  }
  return null
}

/**
 * 試験の結果。
 *
 * **`stateChanged: false` を「送信済み」「反映済み」と書かない。**
 * dry-runなので誰にも届いておらず、登録も配信もタグ付けも起きていない。
 */
export function testResultText(input: {
  kind: 'first_time' | 'returning'
  scenarioName: string | null
  suppressed: boolean
  actionCount: number
}): string {
  const who = input.kind === 'first_time' ? '初回登録の人' : '再追加の人'
  if (input.suppressed) return `${who}には送りません（対象外）。実際の送信はしていません。`
  const scenario = input.scenarioName ?? NOT_AVAILABLE
  return `${who}へ「${scenario}」を開始し、アクションを${input.actionCount}件実行します。`
    + '実際の送信・登録・タグ付けはしていません。'
}

/**
 * 再追加時の制限の説明。
 *
 * **設定値 (0/24/168時間) をそのまま出す。** 「24時間に1回」と固定で
 * 書くと、制限しない・7日に1回を選んだ設定と確認画面が食い違う。
 * 制限が無い (0) ときは「防ぎます」と言わない。
 */
export function suppressionNote(hours: number | null | undefined): string {
  const value = hours ?? 24
  if (value <= 0) {
    return '再追加時の制限はありません。同じ人へ繰り返し届くことがあります。'
  }
  return `再追加は${resendSuppressionText(value)}だけ実行し、LINE公式のあいさつとの二重送信を防ぎます。`
}

/**
 * 実行結果への導線。
 *
 * **`monitoringPath` が `null` のときはリンクにしない。** 無い画面へ
 * 送ると404になる。理由をそのまま出す。
 */
export function monitoringLink(result: FriendAddRoutingPublishResult): {
  href: string | null
  note: string
} {
  if (result.monitoringPath) {
    return { href: result.monitoringPath, note: '配信状況を確認できます。' }
  }
  return {
    href: null,
    note: result.monitoringUnavailableReason ?? '実行結果の画面はまだつながっていません。',
  }
}

/**
 * 公開に付ける鍵。16文字以上でないとWorkerが受け取らない。
 *
 * **押すたびに作り直さない。** 同じ下書きに対しては同じ鍵を使い、
 * 二重に押しても2回公開されないようにする。
 */
export function idempotencyKeyFor(version: FriendAddRoutingVersion): string {
  const key = `friend-add-publish-${version.accountId}-${version.versionId}`
  return key.length >= 16 ? key : key.padEnd(16, '0')
}
