'use client'

import { useEffect, useRef, useState } from 'react'
import { TURNSTILE_SITE_KEY } from '@/lib/auth-email'
import Notice from '@/components/shared/notice'

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

/**
 * Turnstile のエラー番号を日本語にする。
 * Cloudflare の枠は「Webサイトに接続できません」としか出さず、番号は開発者コンソールにしか残らない。
 * 原因が分からないまま登録が止まるのを防ぐため、画面にも番号と対処を出す。
 */
function turnstileErrorMessage(code: string | undefined): string {
  const tail = code ? `（エラー ${code}）` : ''
  // 1102xx はサイトキーの設定ちがい。利用者が何度押しても直らない。
  if (code?.startsWith('1102')) {
    return `このドメインはロボット対策に登録されていないため、確認できません${tail}。運営側の設定が必要です。`
  }
  if (code?.startsWith('1106') || code?.startsWith('1104')) {
    return `ロボット対策の確認に失敗しました${tail}。ページを開き直してもう一度お試しください。`
  }
  return `ロボット対策の確認ができませんでした${tail}。通信環境を確かめて、もう一度お試しください。`
}

export default function Turnstile({
  onToken,
  onError,
  handleRef,
}: {
  onToken: (token: string | null) => void
  onError?: (code?: string) => void
  handleRef?: (handle: TurnstileHandle | null) => void
}) {
  const [errorCode, setErrorCode] = useState<string | null>(null)
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
          callback: (token: string) => {
            setErrorCode(null)
            onTokenRef.current(token)
          },
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': (code?: string) => {
            setErrorCode(code ?? '')
            onTokenRef.current(null)
            onErrorRef.current?.(code)
          },
        })
        handleRef?.({
          reset: () => {
            if (widgetRef.current && window.turnstile) window.turnstile.reset(widgetRef.current)
            setErrorCode(null)
            onTokenRef.current(null)
          },
        })
      })
      .catch(() => {
        setErrorCode('')
        onErrorRef.current?.()
      })
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
      <Notice tone="warn" className="w-full">
        ロボット対策の設定が済んでいないため、この環境では送信できません。
      </Notice>
    )
  }
  return (
    <div className="flex w-full flex-col gap-2">
      <div ref={hostRef} className="w-full" aria-label="ロボットでないことの確認" />
      {errorCode !== null ? (
        <Notice tone="danger" className="w-full">
          {turnstileErrorMessage(errorCode || undefined)}
        </Notice>
      ) : null}
    </div>
  )
}
