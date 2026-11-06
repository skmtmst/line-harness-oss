'use client'

import { useCallback, useLayoutEffect, useReducer, useRef, type MouseEvent } from 'react'

type Activation = {
  button: HTMLButtonElement
  observer: MutationObserver
  complete: boolean
  started: boolean
  finish: (event: AnimationEvent) => void
}

/** The existing star is static on mount. Observe only an actual OFF→ON operation. */
export function useAttentionStarMotion() {
  const active = useRef(false)
  const pending = useRef(new Map<HTMLButtonElement, Activation>())
  const [, renderCompletion] = useReducer((value: number) => value + 1, 0)
  const dispose = useCallback((entry: Activation) => {
    if (pending.current.get(entry.button) !== entry) return
    pending.current.delete(entry.button)
    entry.observer.disconnect()
    entry.button.removeEventListener('animationend', entry.finish)
    entry.button.removeEventListener('animationcancel', entry.finish)
    entry.button.removeAttribute('data-star-pop')
  }, [])
  const sync = useCallback((entry: Activation) => {
    if (!active.current || pending.current.get(entry.button) !== entry) return
    if (!entry.button.isConnected) { dispose(entry); return }
    const pressed = entry.button.getAttribute('aria-pressed') === 'true'
    if (pressed && !entry.started) {
      entry.started = true
      if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) entry.button.setAttribute('data-star-pop', '')
    } else if (!pressed && entry.started) { dispose(entry); return }
    if (entry.complete) {
      entry.observer.disconnect()
      if (!entry.started || !entry.button.hasAttribute('data-star-pop')) dispose(entry)
    }
  }, [dispose])
  useLayoutEffect(() => {
    const entries = pending.current
    active.current = true
    return () => { active.current = false; for (const entry of entries.values()) dispose(entry) }
  }, [dispose])
  // React commits the controlled value before layout effects, including async save completion.
  useLayoutEffect(() => { for (const entry of pending.current.values()) sync(entry) })

  return useCallback((event: MouseEvent<HTMLButtonElement>, action: () => unknown) => {
    const button = event.currentTarget
    for (const entry of pending.current.values()) if (entry.button === button || !entry.button.isConnected) dispose(entry)
    // Removing a star (including a failed removal's rollback) must not arm a new pop.
    if (button.getAttribute('aria-pressed') === 'true') return action()
    const entry: Activation = {
      button, complete: false, started: false,
      observer: new MutationObserver(() => sync(entry)),
      finish: (animation) => { if (animation.animationName === 'v8-star-pop') dispose(entry) },
    }
    pending.current.set(button, entry)
    entry.observer.observe(button, { attributes: true, attributeFilter: ['aria-pressed'] })
    button.addEventListener('animationend', entry.finish)
    button.addEventListener('animationcancel', entry.finish)
    const complete = () => {
      if (active.current && pending.current.get(button) === entry) {
        entry.complete = true
        renderCompletion()
      }
    }
    try {
      const result = action()
      if (result instanceof Promise) return result.then(
        (value) => { complete(); return value },
        (error: unknown) => { complete(); throw error },
      )
      complete()
      return result
    } catch (error) { dispose(entry); throw error }
  }, [dispose, sync])
}
