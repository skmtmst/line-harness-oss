'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import styles from './kpi-card.module.css'

type Snapshot = { scope: string; text: string | null }
type MotionScope = {
  scope: string | null
  firstScope: string | null
  values: Map<string, Snapshot>
  updates: boolean
  initialAllowed: boolean
  ready: boolean
}
const ValueMotion = createContext<MotionScope | null>(null)

/** 初期の表・集計の読み込みが落ち着くまで、装飾のDOMを増やさない。 */
function useInitialContentReady() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const observer = new MutationObserver(check)
    function check() {
      const main = document.querySelector('main')
      if (main) {
        const visible = (element: Element) => element.getClientRects().length > 0
          && !element.closest('[hidden],[inert],[aria-hidden="true"]')
        const busy = Array.from(main.querySelectorAll('[aria-busy="true"], [data-list-state="loading"]')).some(visible)
        const hasValue = Array.from(main.querySelectorAll('[data-kpi-number]')).some(element => visible(element) && /[0-9]/.test(element.textContent ?? ''))
        if (busy || !hasValue) return
      }
      observer.disconnect()
      setReady(true)
    }
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy', 'data-list-state', 'hidden', 'inert', 'aria-hidden'] })
    check()
    return () => observer.disconnect()
  }, [])
  return ready
}

/** アカウント・期間の識別子だけを受ける。読込中も外さず、同値の読み直しを覚えておく。 */
export function KpiValueMotionProvider({ scope, updates = true, children }: { scope: string | null; updates?: boolean; children: ReactNode }) {
  const parent = useContext(ValueMotion)
  const ready = useInitialContentReady()
  const [values] = useState(() => new Map<string, Snapshot>())
  const [session, setSession] = useState(() => ({ scope, revision: 0, firstScope: scope === null ? null : JSON.stringify([scope, 0]) }))
  if (session.scope !== scope) {
    const revision = session.revision + 1
    setSession({ scope, revision, firstScope: session.firstScope ?? (scope === null ? null : JSON.stringify([scope, revision])) })
  }
  // 元の期間へ戻った場合も「同じ期間の更新」と区別する。
  const currentScope = scope === null ? null : JSON.stringify([scope, session.revision])
  const initial = session.firstScope
  const initialAllowed = parent === null || (parent.initialAllowed && parent.scope !== null && parent.scope === parent.firstScope)
  const context = useMemo(() => ({ scope: currentScope, firstScope: initial, values, updates, initialAllowed, ready }), [currentScope, initial, values, updates, initialAllowed, ready])
  return <ValueMotion.Provider value={context}>{children}</ValueMotion.Provider>
}

/** 本当の文字は常にDOMに置き、描画後に読み上げ対象外の数字だけを滑らせる。 */
export function KpiRollingValue({ text, identity, loading }: { text: string; identity: string; loading: boolean }) {
  const context = useContext(ValueMotion)
  const [roll, setRoll] = useState<{ scope: string; text: string } | null>(null)
  const pending = useRef<string | null>(null)
  const scope = context?.scope
  const values = context?.values
  const firstScope = context?.firstScope
  const updates = context?.updates
  const initialAllowed = context?.initialAllowed
  const ready = context?.ready

  useEffect(() => {
    setRoll(null)
    if (scope == null || !values) return
    const previous = values.get(identity)
    const numeric = /[0-9]/.test(text)
    // 切替中に欠測になっても、新しい条件の値を初回と誤認しない。
    if (loading || !numeric) {
      if (previous && previous.scope !== scope) values.set(identity, { scope, text: null })
      return
    }
    values.set(identity, { scope, text })
    const next = JSON.stringify([scope, text])
    const shouldRoll = pending.current === next || (previous === undefined ? initialAllowed && scope === firstScope
      : updates && previous.scope === scope && previous.text !== null && previous.text !== text
    )
    pending.current = null
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!shouldRoll || !media || media.matches) return
    pending.current = next
    if (!ready) return

    let frame = 0
    let task = 0
    let cancelled = false
    // rAFの次のタスクへ渡し、画面の残りが描かれてから装飾用DOMを足す。
    const start = () => {
      frame = window.requestAnimationFrame(() => {
        task = window.setTimeout(() => {
          if (!cancelled && !media.matches) {
            pending.current = null
            setRoll({ scope, text })
          }
        }, 0)
      })
    }
    const stop = () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      window.clearTimeout(task)
      setRoll(null)
    }
    const change = () => { if (media.matches) stop() }
    media.addEventListener('change', change)
    if (document.readyState === 'complete') start()
    else window.addEventListener('load', start, { once: true })
    return () => {
      stop()
      window.removeEventListener('load', start)
      media.removeEventListener('change', change)
    }
  }, [scope, values, firstScope, updates, initialAllowed, ready, text, identity, loading])

  const active = !loading && roll?.scope === scope && roll?.text === text
  return <span className={`${styles.number} ${styles.rollingValue}`} data-kpi-value data-kpi-rolling={active || undefined}>
    <span data-kpi-number className={styles.actualValue}>{text}</span>
    {active ? <span aria-hidden="true" data-kpi-roll className={styles.rollingOverlay} onAnimationEnd={() => setRoll(null)}>
      {Array.from(text, (character, index) => /[0-9]/.test(character) ? (
        <span key={index} className={styles.digitWindow}>
          <span className={styles.digitColumn}>
            <span>{(Number(character) + 1) % 10}</span>
            <span>{(Number(character) + 5) % 10}</span>
            <span>{character}</span>
          </span>
        </span>
      ) : <span key={index}>{character}</span>)}
    </span> : null}
  </span>
}
