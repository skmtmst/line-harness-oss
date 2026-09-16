'use client'

import type { ReactNode } from 'react'
import { useAccount } from '@/contexts/account-context'
import { useFeatureVisibility } from '@/lib/use-feature-visibility'
import type { FeatureKey } from '@/lib/feature-settings'
import { FeatureDisabledScreen } from './feature-disabled-gate'

/**
 * 任意機能の管理画面を直URLで開いたときの入口ゲート。
 *
 * 読み込み中は中身を出す（画面内のAPIが 403 なら共通ゲートが引き継ぐ）。
 * 担当accountの機能がオフと確定したときだけ、画面を無効表示へ差し替える。
 */
export default function FeatureGate({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
  const { selectedAccountId } = useAccount()
  const visibility = useFeatureVisibility(selectedAccountId)
  if (visibility.status === 'ready' && !visibility.enabled(feature)) {
    return <FeatureDisabledScreen featureId={feature} />
  }
  return <>{children}</>
}
