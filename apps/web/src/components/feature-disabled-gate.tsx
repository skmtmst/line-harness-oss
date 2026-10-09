'use client'

import React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { useOptionalAccount } from '@/contexts/account-context'
import { beginFeatureDisabledContext, type FeatureDisabledContext } from '@/lib/feature-disabled-context'
import {
  FEATURE_DISABLED_EVENT,
  type FeatureDisabledEventDetail,
} from '@/lib/api'

/** Pencil の共通エラー状態と同じ枠で、復旧先まで案内する。 */
export function FeatureDisabledScreen({ featureId }: { featureId?: string }) {
  return (
    <section
      className="rounded-card border border-hairline bg-canvas p-6 shadow-card-surface"
      data-feature-disabled={featureId ?? 'unknown'}
    >
      <ListState
        kind="forbidden"
        title="この機能は設定でオフになっています"
        permissionReason="機能設定で有効にすると使えます。"
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
  const selectedAccountId = useOptionalAccount()?.selectedAccountId ?? null
  const [disabledFeatureId, setDisabledFeatureId] = useState<string | undefined>()
  const context = useRef<FeatureDisabledContext | undefined>(undefined)

  /*
   * 機能のオン・オフはアカウントごと。同じ URL のままアカウントを切り替えたときも
   * 案内を外して中身を描き直す（外さないと、オンのアカウントでも中身が読み込まれない：監査 WEB-007）。
   * 中身がまたオフを返せば、そのときに案内が戻る。
   */
  useLayoutEffect(() => {
    context.current = beginFeatureDisabledContext(pathname)
    setDisabledFeatureId(undefined)
  }, [pathname, selectedAccountId])

  useEffect(() => {
    const onDisabled = (event: Event) => {
      const detail = (event as CustomEvent<FeatureDisabledEventDetail>).detail
      if (detail?.accountId != null && detail.accountId !== selectedAccountId) return
      if (detail?.featureContext && (detail.featureContext.generation !== context.current?.generation
        || detail.featureContext.pathname !== pathname)) return
      setDisabledFeatureId(detail?.featureId ?? 'unknown')
    }
    window.addEventListener(FEATURE_DISABLED_EVENT, onDisabled)
    return () => window.removeEventListener(FEATURE_DISABLED_EVENT, onDisabled)
  }, [pathname, selectedAccountId])

  if (disabledFeatureId) return <FeatureDisabledScreen featureId={disabledFeatureId} />
  return <>{children}</>
}
