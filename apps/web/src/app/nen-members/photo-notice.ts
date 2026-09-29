import { ApiError } from '@/lib/api'

/**
 * 写真審査の操作失敗を、利用者に伝わる日本語へ変換する。
 *
 * 口は400のときだけ理由の本文を返す。409（競合）・428（再認証要求）・502
 * （再送失敗）は `API error: NNN` のまま届くので、画面側で状態コード別に
 * 言い換える。知らない状態はそのまま出し、呼び出し側の文面を使う。
 */
export function photoNoticeFor(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return 'ほかの担当者が先に審査しました。一覧を読み直してから、もう一度お試しください。'
    }
    if (error.status === 428) {
      return '操作の確認期限が切れました。一覧を読み直してから、もう一度お試しください。'
    }
    if (error.status === 502) {
      return 'LINEへの通知に失敗しました。時間を置いて、一覧から再送してください。'
    }
    if (error.status === 403) {
      return '写真を操作する権限がありません。管理者に権限を確認してください。'
    }
  }
  if (error instanceof Error && error.message && !/^API error: \d+$/.test(error.message)) {
    return error.message
  }
  return fallback
}
