'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { testSendFailure, testSendResult, type TestSendView } from './test-send-view'

interface TestSendSectionProps {
  broadcastId: string
  accountId: string
  disabled: boolean
}

/**
 * テスト送信（設計 `h0kahp`）。
 *
 * 色・枠・角丸はV6のトークンだけで書く。ここは青・赤・緑・灰と白地を素の
 * Tailwind の色で書き、ボタンの地は16進数で直書きしていた。トークンを1か所
 * 変えても、この節だけ前の色で残る。
 */
export default function TestSendSection({ broadcastId, accountId, disabled }: TestSendSectionProps) {
  const [recipients, setRecipients] = useState<Array<{ id: string; displayName: string; pictureUrl: string | null }>>([])
  // 宛先が「まだ読めていない」のか「登録されていない」のかを分ける。
  // 混ぜると、読み込みの一瞬だけ「未設定です」と嘘を出すことになる。
  const [recipientState, setRecipientState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<TestSendView | null>(null)
  const [cooldown, setCooldown] = useState(false)
  const identityRef = useRef({ accountId, broadcastId })
  const sendGenerationRef = useRef(0)
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  identityRef.current = { accountId, broadcastId }

  useEffect(() => {
    // 前のアカウント・配信の送信結果を、新しい画面へ持ち越さない。
    sendGenerationRef.current += 1
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current)
    cooldownTimerRef.current = null
    setSending(false)
    setResult(null)
    setCooldown(false)
    return () => {
      sendGenerationRef.current += 1
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current)
    }
  }, [accountId, broadcastId])

  useEffect(() => {
    let cancelled = false
    setRecipientState('loading')
    setRecipients([])
    api.accountSettings.getTestRecipients(accountId).then(res => {
      if (cancelled) return
      if (res.success) {
        setRecipients(res.data)
        setRecipientState('ready')
      } else {
        setRecipientState('error')
      }
    }).catch(() => {
      if (!cancelled) setRecipientState('error')
    })
    return () => { cancelled = true }
  }, [accountId])

  const handleTestSend = async () => {
    const request = {
      accountId,
      broadcastId,
      generation: sendGenerationRef.current + 1,
    }
    sendGenerationRef.current = request.generation
    const isCurrentRequest = () =>
      identityRef.current.accountId === request.accountId
      && identityRef.current.broadcastId === request.broadcastId
      && sendGenerationRef.current === request.generation
    const at = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    setSending(true)
    setResult(null)
    try {
      const res = await api.broadcasts.testSend(request.broadcastId)
      if (!isCurrentRequest()) return
      if (res.success) {
        const view = testSendResult(res.sent ?? 0, res.failed ?? 0, at)
        setResult(view)
        if (view.kind !== 'error') {
          setCooldown(true)
          cooldownTimerRef.current = setTimeout(() => {
            if (isCurrentRequest()) setCooldown(false)
          }, 10000)
        }
      } else {
        // 失敗の応答を黙って捨てると、押しても何も起きない画面になる。
        setResult(testSendFailure(at))
      }
    } catch {
      if (isCurrentRequest()) setResult(testSendFailure(at))
    } finally {
      if (isCurrentRequest()) setSending(false)
    }
  }

  return (
    <div className="bg-canvas rounded-card border-hairline border p-4">
      <h3 className="text-ink-secondary mb-2 text-sm font-semibold">テスト送信</h3>
      {recipientState === 'loading' ? (
        <p className="text-ink-faint text-xs">読み込んでいます</p>
      ) : recipientState === 'error' ? (
        <p className="text-ink-faint text-xs">
          テスト送信先を読み込めませんでした。通信状態を確認して、画面を再読み込みしてください。
        </p>
      ) : recipients.length === 0 ? (
        <p className="text-ink-faint text-xs">
          テスト送信先が未設定です。
          <Link href="/accounts" className="text-action ml-1 hover:underline">アカウント設定</Link>
          から設定してください。
        </p>
      ) : (
        <>
          <p className="text-ink-faint mb-2 text-xs">
            送信先: {recipients.map(r => r.displayName).join(', ')} ({recipients.length}名)
          </p>
          <button
            onClick={handleTestSend}
            disabled={disabled || sending || cooldown}
            className="bg-action text-on-action rounded-control min-h-[44px] px-4 py-2 text-xs font-medium transition-opacity disabled:opacity-50"
          >
            {sending ? 'テスト送信中...' : cooldown ? '送信済み' : 'テスト送信する'}
          </button>
          {result && (
            <p className={`mt-2 text-xs ${result.kind === 'success' ? 'text-success' : 'text-danger'}`}>
              {result.message}
            </p>
          )}
        </>
      )}
    </div>
  )
}
