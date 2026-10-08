'use client'

import React from 'react'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { useAccount } from '@/contexts/account-context'
import {
  FEATURE_DISABLED_EVENT,
  type FeatureDisabledEventDetail,
} from '@/lib/api'

/** Pencil の共通エラー状態と同じ枠で、復旧先まで案内する。 */
export function FeatureDisabledScreen({ featureId }: { featureId?: string }) {
  return (
    <section
      className="rounded-card border border-hairline bg-canvas p-6 shadow-card"
      data-feature-disabled={featureId ?? 'unknown'}
    >
      <ListState
        kind="forbidden"
        title="この機能は設定でオフになっています"
        description="機能設定で有効にすると使えます。"
        action={<Button href="/settings" variant="secondary">機能設定を開く</Button>}
      />
    </section>
  )
}

/**
 * URLを直接開いた場合も、ページ固有の失敗表示へ落とさず本文を差し替える。
 * 通常の403はイベントが来ないため、各画面の従来の権限案内を保つ。
 */
export default function FeatureDisabledGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { selectedAccountId } = useAccount()
  const [disabledFeatureId, setDisabledFeatureId] = useState<string | undefined>()

  /*
   * 機能のオン・オフはアカウントごと。同じ URL のままアカウントを切り替えたときも
   * 案内を外して中身を描き直す（外さないと、オンのアカウントでも中身が読み込まれない：監査 WEB-007）。
   * 中身がまたオフを返せば、そのときに案内が戻る。
   */
  useEffect(() => {
    setDisabledFeatureId(undefined)
  }, [pathname, selectedAccountId])

  useEffect(() => {
    const onDisabled = (event: Event) => {
      const detail = (event as CustomEvent<FeatureDisabledEventDetail>).detail
      setDisabledFeatureId(detail?.featureId ?? 'unknown')
    }
    window.addEventListener(FEATURE_DISABLED_EVENT, onDisabled)
    return () => window.removeEventListener(FEATURE_DISABLED_EVENT, onDisabled)
  }, [])

  if (disabledFeatureId) return <FeatureDisabledScreen featureId={disabledFeatureId} />
  return <>{children}</>
}
