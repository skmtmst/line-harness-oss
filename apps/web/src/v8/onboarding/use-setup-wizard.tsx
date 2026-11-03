'use client'

import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useListNavigationRouter } from '@/components/shared/list-navigation'
import { canManageRole } from '@/lib/staff-role'
import type { StyleState } from './model'

const StyleSetupWizard = dynamic(() => import('./wizard'))
type Step = number | 'summary'

/** 選択中のホームで質問を開き、別の店や取得前の設定を使わない。 */
export function useSetupWizard(accountId: string | null, state: StyleState | null | undefined, role: string | null, onChanged: () => void) {
  const router = useListNavigationRouter()
  const params = useSearchParams()
  const setupParam = params.get('setup')
  const qrRequested = params.has('qr')
  const canManage = canManageRole(role)
  const closedAccount = useRef<string | null>(null)
  const [opened, setOpened] = useState<{ accountId: string; step: Step } | null>(null)

  useEffect(() => { closedAccount.current = null }, [accountId])
  useEffect(() => {
    if (!accountId) { setOpened(null); return }
    if (setupParam === 'summary') setOpened({ accountId, step: 'summary' })
    else if (setupParam !== null && /^\d+$/.test(setupParam)) setOpened({ accountId, step: Number(setupParam) })
    else setOpened(null)
  }, [setupParam, accountId])
  useEffect(() => {
    if (!state || !canManage || state.styleSelected || !accountId || qrRequested || closedAccount.current === accountId) return
    if (state.shouldPromptStyleSelection !== true) return
    setOpened(current => current?.accountId === accountId ? current : { accountId, step: 0 })
  }, [state, canManage, accountId, qrRequested])

  const openStep = (value: string | number) => {
    if (!canManage || !accountId || !state) return
    const step = typeof value === 'number' ? value : value === 'summary' ? value : ['style', 'image'].indexOf(value)
    if (typeof step === 'number' && (!Number.isFinite(step) || step < 0)) return
    setOpened({ accountId, step })
  }
  const close = (changed: boolean) => {
    closedAccount.current = accountId
    setOpened(null)
    if (setupParam !== null) {
      const next = new URLSearchParams(params.toString())
      const returnToAccounts = next.get('setupReturn') === 'accounts'
      next.delete('setup')
      next.delete('setupReturn')
      router.replace(returnToAccounts ? '/accounts' : next.size ? `/?${next.toString()}` : '/')
    }
    if (changed) onChanged()
  }

  return {
    openStep,
    qrRequested,
    dialog: opened && opened.accountId === accountId && accountId && state && canManage
      ? <StyleSetupWizard key={accountId} accountId={accountId} state={state} initialStep={opened.step} onClose={close} /> : null,
  }
}
