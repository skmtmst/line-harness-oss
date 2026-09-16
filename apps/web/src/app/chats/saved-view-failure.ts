import { ApiError } from '@/lib/api'

/**
 * 保存した検索の保存失敗を、運用者向けの文言へ写す(N-027)。
 *
 * `fetchApi` は !ok を ApiError として投げる。409(同名の競合)と403(権限)と
 * 通信障害を同じ「時間を置いて」で済ませると、名前を変えれば直る競合まで
 * 待たせてしまう。APIが返す内部文言はここへ持ち込まず、画面用の文だけ返す。
 */
export function savedViewFailureMessage(reason: unknown): string {
  if (reason instanceof ApiError) {
    if (reason.status === 409) {
      return '同じ名前の保存した検索があります。別の名前を入力してください。'
    }
    if (reason.status === 403) {
      return 'この検索を保存する権限がありません。担当の管理者へ確認してください。'
    }
  }
  return '保存できませんでした。時間を置いてもう一度お試しください。'
}
