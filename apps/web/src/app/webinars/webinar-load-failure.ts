import { ApiError } from '@/lib/api'
import type { ListStateKind } from '@/components/shared/list-state'

/**
 * 読み込めなかった理由。**「失敗」で一括りにしない。**
 *
 * 403 は読み直しても直らない（権限を足してもらうしかない）、429 は待てば
 * 直る、それ以外は通信を確かめる。**同じ「もう一度読み込む」を出すと、
 * 権限不足の人は何度押しても直らない道へ誘われる。**
 */
export type WebinarLoadFailure = {
  kind: Extract<ListStateKind, 'error' | 'forbidden'>
  title: string
  description: string
  /** 押しても直らないときは、読み直しの口を出さない。 */
  retryable: boolean
}

export function webinarLoadFailure(error: unknown): WebinarLoadFailure {
  if (error instanceof ApiError && error.status === 403) {
    return {
      kind: 'forbidden',
      title: 'ウェビナーを見る権限がありません',
      description: 'このLINEアカウントを見る権限を、オーナーか管理者に確認してください。',
      retryable: false,
    }
  }
  if (error instanceof ApiError && error.status === 429) {
    return {
      kind: 'error',
      title: 'ウェビナーの読み込みが混み合っています',
      description: '少し待ってから、もう一度読み込んでください。',
      retryable: true,
    }
  }
  return {
    kind: 'error',
    title: 'ウェビナーを表示できませんでした',
    description: '通信状態を確認して、もう一度読み込んでください。',
    retryable: true,
  }
}
