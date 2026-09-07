'use client'

import React from 'react'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import {
  FEATURE_DISABLED_EVENT,
  type FeatureDisabledEventDetail,
} from '@/lib/api'

/** Pencil の共通エラー状態と同じ枠で、復旧先まで案内する。 */
export function FeatureDisabledScreen({ featureId }: { featureId?: string }) {
  return (
    <section
      className="rounded-card border border-hairline bg-canvas p-6 shadow-sm"
      data-feature-disabled={featureId ?? 'unknown'}
    >
      <ListState
        kind="forbidden"
        title="この機能は設定でオフになっています"
        description="機能設定で有効にすると使えます。"
        action={<Button href="/settings" variant="primary">機能設定を開く</Button>}
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
  const [disabledFeatureId, setDisabledFeatureId] = useState<string | undefined>()

  useEffect(() => {
    setDisabledFeatureId(undefined)
  }, [pathname])

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
