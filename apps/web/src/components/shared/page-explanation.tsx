'use client'

import { createContext, useContext, useId, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useStaffIdentity } from '@/lib/staff-role'
import styles from './page-explanation.module.css'

type ExplanationState = { open: boolean; toggle: () => void; bodyId: string; toggleId: string }
const Context = createContext<ExplanationState | null>(null)

/** ：人と画面ごとの開閉。保存できない端末でも、その場の開閉は保つ。 */
export function PageExplanationProvider({ pageKey, children }: { pageKey: string; children: ReactNode }) {
  const staff = useStaffIdentity()
  const key = staff?.id ? `lh_page_explanation_v1:${staff.id}:${pageKey}` : null
  const [state, setState] = useState({ key: null as string | null, open: true })
  const id = useId()
  useLayoutEffect(() => {
    let open = true
    if (key) {
      try { open = window.localStorage.getItem(key) !== 'closed' } catch { /* 覚えられない端末では初めは開く。 */ }
    }
    setState(current => current.key === key ? current : { key, open })
  }, [key])
  const value = useMemo(() => ({
    open: state.open,
    bodyId: `${id}-body`,
    toggleId: `${id}-toggle`,
    toggle: () => {
      const open = !state.open
      setState({ key, open })
      if (key) {
        try { window.localStorage.setItem(key, open ? 'open' : 'closed') } catch { /* 表示の切り替えは続ける。 */ }
      }
    },
  }), [id, key, state.open])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

function useExplanation() {
  const context = useContext(Context)
  if (!context) throw new Error('画面の説明はPageExplanationProviderの中に置いてください')
  return context
}

export function PageExplanationToggle() {
  const { open, toggle, bodyId, toggleId } = useExplanation()
  const Chevron = open ? ChevronUp : ChevronDown
  return <button type="button" id={toggleId} className={styles.toggle} data-shared-part="page-explanation-toggle" data-screen-explanation-toggle aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
    この画面の説明<Chevron size={16} aria-hidden="true" />
  </button>
}

export function PageExplanationBody({ children, keepMounted = false, inset }: { children: ReactNode; keepMounted?: boolean; inset?: 'notice' }) {
  const { open, bodyId, toggleId } = useExplanation()
  return open || keepMounted ? <div hidden={!open} data-screen-explanation className={styles.body} data-explanation-inset={inset} id={bodyId} role="region" aria-labelledby={toggleId}>{children}</div> : null
}
