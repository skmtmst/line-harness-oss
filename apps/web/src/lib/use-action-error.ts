'use client'

import { useCallback, useEffect, useState } from 'react'
import { describeApiFailure } from '@/components/shared/api-error-message'

/** 操作の失敗は一覧取得から独立させる。対象変更・再操作・明示的な閉じる時だけ消す。 */
export function useActionError(target: string) {
  const [error, setError] = useState('')
  const clear = useCallback(() => setError(''), [])
  useEffect(clear, [target, clear])
  return { error, setError, clear }
}

export function describeActionFailure(caught: unknown, action: string): string {
  const status = caught && typeof caught === 'object' && 'status' in caught ? caught.status : undefined
  if (status === 409) return `状態が変わったため${action}できませんでした。最新の一覧を確かめてから、もう一度お試しください。`
  if (caught instanceof TypeError || status === undefined || (typeof status === 'number' && status >= 500)) {
    return `通信に失敗したため${action}結果を確認できませんでした。最新の一覧を確かめてから、もう一度お試しください。`
  }
  return describeApiFailure(caught, action)
}
