import type { WebinarPublishValidation } from '@/lib/api'

/*
 * R93: 設定サマリーと最終確認の文言は値に連動させる。未設定・未検証の
 * まま「確認しました」「追加」と出す固定文は置かない。
 */

function findCheck(validation: WebinarPublishValidation | null, key: string) {
  return validation?.checks.find((check) => check.key === key) ?? null
}

/** 最終確認の「アクション」行。視聴後アクションの検査結果をそのまま出す。 */
export function reviewActionSummaryText(validation: WebinarPublishValidation | null): string {
  const check = findCheck(validation, 'action_dependencies')
  if (!check) return '—（未取得）'
  return check.detail || check.label
}

/** 設定サマリーのプレビュー文。通知・公開ページのテスト結果で分ける。 */
export function reviewTestSummaryBody(
  validation: WebinarPublishValidation | null,
  validationState: 'loading' | 'ready' | 'error',
): string {
  if (!validation) {
    return validationState === 'error'
      ? '公開前検査を取得できませんでした。左の段からもう一度読み込んでください。'
      : '公開前検査を読み込んでいます。'
  }
  const pending: string[] = []
  if (findCheck(validation, 'notification_test')?.status !== 'passed') pending.push('通知のテスト送信')
  if (findCheck(validation, 'public_page_test')?.status !== 'passed') pending.push('公開ページの確認')
  return pending.length === 0
    ? '公開ページと通知のテスト結果を確認しました。'
    : `${pending.join('・')}が終わっていません。`
}

/** 設定サマリーの「監視」行。失敗の件数で分ける。 */
export function reviewMonitoringText(failures: number): string {
  return failures > 0 ? `${failures}件の要確認` : '問題なし'
}
