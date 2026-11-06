'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { api, type BroadcastMessageAsset } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import ListState from '@/components/shared/list-state'
import { TemplateEditFrame } from './frame'

/** A stored coupon is opened through the same editor as a new coupon. */
export default function StoredAssetEditor({ id, children }: { id: string; children: (asset: BroadcastMessageAsset) => ReactNode }) {
  const { selectedAccountId } = useAccount()
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ scope: string; id: string; asset?: BroadcastMessageAsset; failed?: boolean } | null>(null)
  useEffect(() => {
    if (!selectedAccountId) return
    let current = true
    setResult(null)
    void api.broadcastMessageAssets.list({ accountId: selectedAccountId, kind: 'coupon' }).then(response => {
      if (!current) return
      const asset = response.success ? response.data.find(item => item.id === id && (item.lineAccountId === selectedAccountId || item.lineAccountId === null)) : undefined
      setResult({ scope: selectedAccountId, id, asset, failed: !asset })
    }).catch(() => { if (current) setResult({ scope: selectedAccountId, id, failed: true }) })
    return () => { current = false }
  }, [selectedAccountId, id, attempt])
  const active = result?.scope === selectedAccountId && result.id === id ? result : null
  if (active?.asset) return children(active.asset)
  return <TemplateEditFrame boardId="S6FEuB" title="クーポンを編集する" description="保存されているクーポンを読み込みます。" side={null}>
    <ListState kind={active?.failed || !selectedAccountId ? 'error' : 'loading'} onRetry={() => setAttempt(value => value + 1)} />
  </TemplateEditFrame>
}
