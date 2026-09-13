'use client'

import { useEffect, useRef } from 'react'
import { TURNSTILE_SITE_KEY } from '@/lib/auth-email'

/**
 * Cloudflare Turnstile（ロボット対策）の部品。★V6 36-4 の「ロボット対策」枠。
 *
 * サイト用の鍵 `NEXT_PUBLIC_TURNSTILE_SITE_KEY` はビルド時に入る（公開してよい鍵）。
 * 秘密の鍵は Worker 側にだけある。鍵が無い環境では枠を出さず、親が送信を止める。
 * 部品が出したトークンは 1 回きり。送信に失敗したら `reset` で取り直す。
 */

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, options: Record<string, unknown>) => string
      reset: (id?: string) => void
      remove: (id: string) => void
    }
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let loading: Promise<void> | null = null

function loadScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.turnstile) return Promise.resolve()
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      loading = null
      reject(new Error('turnstile script failed'))
    }
    document.head.appendChild(script)
  })
  return loading
}

export type TurnstileHandle = { reset: () => void }

export default function Turnstile({
  onToken,
  onError,
  handleRef,
}: {
  onToken: (token: string | null) => void
  onError?: () => void
  handleRef?: (handle: TurnstileHandle | null) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const widgetRef = useRef<string | null>(null)
  const onTokenRef = useRef(onToken)
  const onErrorRef = useRef(onError)
  onTokenRef.current = onToken
  onErrorRef.current = onError

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    let cancelled = false
    loadScript()
      .then(() => {
        if (cancelled || !hostRef.current || !window.turnstile) return
        widgetRef.current = window.turnstile.render(hostRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          language: 'ja',
          theme: 'light',
          size: 'flexible',
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => {
            onTokenRef.current(null)
            onErrorRef.current?.()
          },
        })
        handleRef?.({
          reset: () => {
            if (widgetRef.current && window.turnstile) window.turnstile.reset(widgetRef.current)
            onTokenRef.current(null)
          },
        })
      })
      .catch(() => onErrorRef.current?.())
    return () => {
      cancelled = true
      handleRef?.(null)
      if (widgetRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetRef.current)
        } catch {
          // すでに消えている
        }
      }
      widgetRef.current = null
    }
  }, [handleRef])

  if (!TURNSTILE_SITE_KEY) {
    return (
      <div role="note" className="w-full rounded-control bg-status-warn-soft px-4 py-3 text-caption text-status-warn-deep">
        ロボット対策の設定が済んでいないため、この環境では送信できません。運営にお問い合わせください。
      </div>
    )
  }
  return <div ref={hostRef} className="w-full" aria-label="ロボットでないことの確認" />
}
