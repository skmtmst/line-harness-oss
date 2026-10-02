/*
 * リッチメニュー一覧の、失敗を運用者向けの文へ置き換える共有の関数。
 * ★V7（page.tsx）と★V8（list-v8.tsx）で同じ文を使うための1か所。
 * （page.tsx は Next.js の決まりで自由な export を持てない）
 */
import { ApiError } from '@/lib/api'

export type RichMenuAction = 'load' | 'reorder' | 'delete' | 'unpublish' | 'externalDelete' | 'import'

/** APIや通信の内部表現を、運用者が次の行動を選べる文へ置き換える。 */
export type RichMenuActionAll = RichMenuAction | 'duplicate'

/** APIや通信の内部表現を、運用者が次の行動を選べる文へ置き換える。 */
export function richMenuErrorAll(error: unknown, action: RichMenuActionAll): string {
  if (action === 'duplicate') {
    if (error instanceof ApiError && error.status === 409) {
      return '複製がほかの操作と重なりました。一覧を読み直してから、もう一度お試しください。'
    }
    return 'リッチメニューを複製できませんでした。もう一度お試しください。'
  }
  return richMenuError(error, action)
}

export function richMenuError(error: unknown, action: RichMenuAction): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'このLINEアカウントのリッチメニューを操作する権限がありません。'
    if (error.status === 404) return '対象のリッチメニューが見つかりません。一覧を読み直してください。'
    if (error.status === 409) {
      return action === 'delete' || action === 'externalDelete'
        ? '使用中のため削除できませんでした。表示先を確認してから、もう一度お試しください。'
        : 'ほかの変更と重なりました。一覧を読み直してから、もう一度お試しください。'
    }
    if (error.status === 429) return 'LINEへの操作が混み合っています。少し待ってから、もう一度お試しください。'
  }

  switch (action) {
    case 'load':
      return 'リッチメニューを読み込めませんでした。通信状態を確認して、もう一度読み込んでください。'
    case 'reorder':
      return 'リッチメニューの順番を変更できませんでした。一覧を読み直してから、もう一度お試しください。'
    case 'delete':
      return 'リッチメニューを削除できませんでした。状態を確認して、もう一度お試しください。'
    case 'unpublish':
      return 'リッチメニューをLINEから取り下げられませんでした。状態を確認して、もう一度お試しください。'
    case 'externalDelete':
      return 'LINE上のリッチメニューを削除できませんでした。LINEの状態を確認して、もう一度お試しください。'
    case 'import':
      return 'LINE上のリッチメニューを取り込めませんでした。LINEの状態を確認して、もう一度お試しください。'
  }
}
