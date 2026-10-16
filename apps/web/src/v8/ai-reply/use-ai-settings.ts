'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { readSessionSnapshot } from '@/lib/session-snapshot'
import { useStaffRole } from '@/lib/staff-role'
import { aiReplyApi, type AiSettings } from './api'
import { aiPermissions } from './words'

export type AiSettingsStatus = 'loading' | 'ready' | 'error'

/**
 * 店の AI の段（要件 G2 §2-2）と、いまの人の権限。
 * 読めないときは「使っていない」と同じ扱いにする（空の枠・押せないボタンを出さない）。
 */
export function useAiSettings(accountId: string | null) {
  const role = useStaffRole()
  const impersonating = Boolean(readSessionSnapshot()?.impersonation)
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [status, setStatus] = useState<AiSettingsStatus>('loading')
  const generation = useRef(0)

  const load = useCallback(async () => {
    const mine = ++generation.current
    if (!accountId) { setSettings(null); setStatus('ready'); return }
    setStatus('loading')
    try {
      const res = await aiReplyApi.settings(accountId)
      if (mine !== generation.current) return
      setSettings(res.data)
      setStatus('ready')
    } catch {
      if (mine !== generation.current) return
      setSettings(null)
      setStatus('error')
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  const mode = settings?.mode ?? 'off'
  return { settings, setSettings, status, reload: load, mode, role, impersonating, permissions: aiPermissions(role, impersonating, mode) }
}
