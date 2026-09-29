import { ApiError } from '@/lib/api'

/**
 * M012：友だち本体の読み込み失敗の種類。
 *
 * 403 は権限不足（押しても直らないので再試行口を出さない）。
 * それ以外は通信・サーバ側の失敗として再試行口を出す。
 * page.tsx と試験の両方から読む（page.tsx には default 以外を置けないため）。
 */
export function loadFailureKind(error: unknown): 'forbidden' | 'error' {
  if (error instanceof ApiError && error.status === 403) return 'forbidden'
  return 'error'
}
