'use client'

import { useEffect, useState } from 'react'
import { api } from './api'
import type { FeatureKey } from './feature-settings'

export type FeatureVisibilityStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * 担当accountの機能オン／オフを staff 向け read-model から読む。
 *
 * サイドバーと同じ fail-closed: 読み込み中・失敗・account 未選択では
 * `enabled()` は false を返す。機能の本体画面ではない場所（友だち一覧の
 * 保存済み検索など）から任意機能のAPIを呼ぶとき、その機能がオフだと
 * 403 が画面全体を共通ゲートへ切り替えるので、**呼ぶ前にここで絞る**。
 */
export function useFeatureVisibility(accountId: string | null | undefined): {
  status: FeatureVisibilityStatus
  features: Record<string, boolean> | null
  enabled: (key: FeatureKey) => boolean
} {
  const [state, setState] = useState<{
    status: FeatureVisibilityStatus
    features: Record<string, boolean> | null
  }>({ status: 'idle', features: null })

  useEffect(() => {
    if (!accountId) {
      setState({ status: 'idle', features: null })
      return
    }
    let cancelled = false
    setState({ status: 'loading', features: null })
    void api.featureSettings
      .visibility(accountId)
      .then((res) => {
        const features = res.success ? res.data?.features : undefined
        if (cancelled) return
        setState(
          features && typeof features === 'object'
            ? { status: 'ready', features }
            : { status: 'error', features: null },
        )
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', features: null })
      })
    return () => {
      cancelled = true
    }
  }, [accountId])

  return {
    ...state,
    enabled: (key) => state.features?.[key] === true,
  }
}
