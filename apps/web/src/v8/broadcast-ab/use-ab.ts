'use client'

import { useCallback, useState } from 'react'
import type { BroadcastBubble } from '@line-crm/shared'
import { broadcastAbApi, type AbSettings } from './api'
import { AB_DEFAULT } from './model'

/**
 * 一斉配信の作成での A/B の状態（③ の A・B 案、④ の設定）。
 * A 案は今までの本文（フォームの bubbles）。B 案はここで持ち、保存のときに口へ送る。
 */
export function useBroadcastAb() {
  const [tab, setTab] = useState<'A' | 'B'>('A')
  const [b, setB] = useState<BroadcastBubble[] | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [settings, setSettings] = useState<AbSettings>(AB_DEFAULT)

  const addB = useCallback((from: BroadcastBubble[]) => {
    /* B 案は A 案の写しから始める（直す所だけ変えられる）。 */
    setB(from.map((bubble, index) => ({ ...bubble, id: `b-${Date.now()}-${index}`, content: { ...bubble.content } })))
    setTab('B')
    setEnabled(true)
  }, [])
  const removeB = useCallback(() => { setB(null); setTab('A'); setEnabled(false) }, [])

  /* 保存のあと：B 案と設定を口へ送る。A/B を外したら設定を消す。 */
  const persist = useCallback(async (broadcastId: string) => {
    if (b && enabled) {
      await broadcastAbApi.saveVariant(broadcastId, 'B', b)
      await broadcastAbApi.saveTest(broadcastId, settings)
    }
  }, [b, enabled, settings])

  return { tab, setTab, b, setB, hasB: b !== null, enabled: enabled && b !== null, setEnabled, settings, setSettings, addB, removeB, persist }
}

export type BroadcastAb = ReturnType<typeof useBroadcastAb>
