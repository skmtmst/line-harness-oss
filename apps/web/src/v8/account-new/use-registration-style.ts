'use client'

import { useEffect, useState } from 'react'
import type { AccountStyle } from '@line-crm/shared'
import { styleApi } from '@/lib/api/helpers/styles'
import { accountStyleUpdated } from '@/hooks/use-account-style'
import { describeApiFailure } from '@/components/shared/api-error-message'

export const REGISTRATION_STYLE_KEY = 'musubo-registration-style'

/** アカウント作成の後半だけ再開する。接続・作成をもう一度呼ばない。 */
export function useRegistrationStyle(accountId: string, enabled: boolean) {
  const [choice, setChoice] = useState<AccountStyle | ''>('')
  const [version, setVersion] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!enabled || !accountId) return
    let active = true
    setVersion(null); setError('')
    void styleApi.get(accountId).then(res => {
      if (!res.success) throw new Error('使い方を読み込めませんでした')
      if (!active) return
      setVersion(res.data.version)
      setChoice(current => current || (res.data.styleSelected ? res.data.style : ''))
    }).catch(caught => { if (active) setError(describeApiFailure(caught, '読み込み')) })
    return () => { active = false }
  }, [accountId, enabled, tick])
  const save = async () => {
    if (busy || !choice || version === null) return false
    setBusy(true); setError('')
    try {
      const res = await styleApi.save(accountId, { expectedVersion: version, style: choice, answers: {} })
      if (!res.success) throw new Error('使い方を保存できませんでした')
      setVersion(res.data.version)
      accountStyleUpdated(accountId)
      try { sessionStorage.removeItem(REGISTRATION_STYLE_KEY) } catch { /* 保存済みの版を再読すれば再開できる。 */ }
      return true
    } catch (caught) {
      setError(describeApiFailure(caught, '保存'))
      return false
    } finally { setBusy(false) }
  }
  return { choice, setChoice, version, busy, error, reload: () => setTick(n => n + 1), save }
}
