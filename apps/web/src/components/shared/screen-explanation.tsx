'use client'

import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { readStaffIdentity, subscribeStaffIdentity } from '@/lib/staff-identity-state'
import styles from './screen-explanation.module.css'

/** ：画面全体の説明。保存するのは人のID・画面・開閉だけ。 */
export default function ScreenExplanation({ title, children, screenKey, titleClassName, panelClassName }: { title: ReactNode; children?: ReactNode; screenKey?: string; titleClassName?: string; panelClassName?: string }) {
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname
  const identity = useSyncExternalStore(subscribeStaffIdentity, readStaffIdentity, () => null)
  const id = useId()
  const params = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search)
  const section = ['tab', 'view', 'pane'].map(name => `${name}=${params?.get(name) ?? ''}`).join('&')
  const key = identity ? `lh_screen_explanation:${identity.id}:${screenKey ?? `${pathname}?${section}`}` : null
  const [preference, setPreference] = useState<{ key: string | null; open: boolean }>({ key: null, open: true })
  const open = preference.key === key ? preference.open : true
  useEffect(() => {
    let visible = true
    try { if (key) visible = localStorage.getItem(key) !== 'closed' } catch { /* 保存が使えなくても説明を読める。 */ }
    setPreference({ key, open: visible })
  }, [key])
  const toggle = () => {
    const next = !open
    setPreference({ key, open: next })
    try { if (key) localStorage.setItem(key, next ? 'open' : 'closed') } catch { /* 開閉自体は保つ。 */ }
  }
  return <>
    <div className={`${styles.titleRow} ${titleClassName ?? ''}`}>{title}{children ? <button data-screen-explanation-toggle type="button" className={styles.toggle} aria-expanded={open} aria-controls={id} onClick={toggle}>この画面の説明{open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}</button> : null}</div>
    {children ? <div id={id} className={`${styles.panel} ${panelClassName ?? ''}`} hidden={!open} data-screen-explanation>{children}</div> : null}
  </>
}
