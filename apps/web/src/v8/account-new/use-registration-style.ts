'use client'

import { useEffect, useRef, useState } from 'react'
import type { AccountStyle } from '@line-crm/shared'
import { styleApi } from '@/lib/api/helpers/styles'
import { accountStyleUpdated } from '@/hooks/use-account-style'
import { describeApiFailure } from '@/components/shared/api-error-message'
import { readStaffIdentity } from '@/lib/staff-identity-state'
import type { InitialMenuSelection } from '@/v8/onboarding'
import { registrationStorageKey } from './registration-storage'

export const REGISTRATION_STYLE_KEY = 'musubo-registration-style'

/** アカウント作成の後半だけ再開する。接続・作成をもう一度呼ばない。 */
export function useRegistrationStyle(accountId: string, enabled: boolean) {
  const resumeKey = registrationStorageKey(REGISTRATION_STYLE_KEY, readStaffIdentity())
  const [menu,setMenu]=useState<InitialMenuSelection>({value:'simple'})
  const [choice, setChoice] = useState<AccountStyle | ''>('')
  const [version, setVersion] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const busyLock = useRef(false)
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
    if (busyLock.current || !choice || version === null) return false
    busyLock.current = true
    setBusy(true); setError('')
    try {
      if(menu.value==='existing'&&!menu.resourceId)throw new Error('使うリッチメニューを選んでください')
      const set=await styleApi.starterSet(accountId,choice,menu.value==='simple')
      if(!set.success)throw new Error('メニューを確認できませんでした')
      const key=set.data.definition.items.find(item=>item.kind==='rich_menu')?.key
      const image=menu.value==='later'?{mode:'later' as const}:{mode:'configured' as const,value:menu.value==='simple'?'simple':'existing',...(menu.value==='existing'?{resourceId:menu.resourceId}:{})}
      const choices=key?{[key]:menu.value==='existing'?{mode:'existing' as const,resourceId:menu.resourceId!}:{mode:'sample' as const}}:undefined
      const res = await styleApi.save(accountId, { expectedVersion: version, style: choice, confirmInitialMenu:menu.value==='simple',answers: {image},choices })
      if (!res.success) throw new Error('使い方を保存できませんでした。時間をおいて、もう一度お試しください。')
      setVersion(res.data.version)
      accountStyleUpdated(accountId)
      try { if (resumeKey) sessionStorage.removeItem(resumeKey) } catch { /* 保存済みの版を再読すれば再開できる。 */ }
      return true
    } catch (caught) {
      setError(describeApiFailure(caught, '保存'))
      return false
    } finally { busyLock.current = false; setBusy(false) }
  }
  const skip = async () => {
    if (busyLock.current || version === null) return false
    busyLock.current = true
    setBusy(true); setError('')
    try {
      const res = await styleApi.save(accountId, { expectedVersion: version, styleMode: 'later' })
      if (!res.success) throw new Error('スキップを保存できませんでした。時間をおいて、もう一度お試しください。')
      setVersion(res.data.version)
      setChoice('')
      accountStyleUpdated(accountId)
      try { if (resumeKey) sessionStorage.removeItem(resumeKey) } catch { /* 設定画面であとから変更できる。 */ }
      return true
    } catch (caught) {
      setError(describeApiFailure(caught, 'スキップ'))
      return false
    } finally { busyLock.current = false; setBusy(false) }
  }
  return { choice, setChoice, menu, setMenu, accountId, version, busy, error, reload: () => setTick(n => n + 1), save, skip }
}
