'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'

/**
 * リマインダのテスト送信の状態（DEEP-09/10/11）。
 *
 * 通信中・結果不明・失敗・成功を1つの状態で持ち、画面はこの状態だけを見る。
 * 同じ試行の途中経過や古い失敗文が別の場所に残らない。
 *
 * - `unknown` … 通信例外で応答を失い、届いたか分からない。
 *   同じ冪等キーで再試行すれば、Worker の送信予約（outbound_send_requests）と
 *   LINE のリトライキーが二重送信を防ぐ。送り直しても1通に収まる。
 * - `failed` … サーバーが失敗を確定して返した。
 * - `succeeded` … 送信が確認できた。
 */
export type ReminderTestSendPhase =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'unknown'; message: string }
  | { kind: 'failed'; message: string }
  | { kind: 'succeeded'; recipientName: string; testedAt: string }

/**
 * `send()` の呼び出し側への結果。画面に出す状態は `phase` が持つので、
 * ここでは「窓を閉じるか・送信先を読み直すか」といった後始末の分岐だけを返す。
 */
export type ReminderTestSendOutcome =
  | { kind: 'succeeded'; recipientName: string; testedAt: string }
  | { kind: 'failed'; recipientFault: boolean }
  | { kind: 'unknown' }
  /** 送信中に対象のリマインダが切り替わった。応答は画面へ反映していない。 */
  | { kind: 'stale' }
  | { kind: 'unavailable' }

export function useReminderTestSend(reminderId: string | null) {
  const [phase, setPhase] = useState<ReminderTestSendPhase>({ kind: 'idle' })
  /*
   * 冪等キーは「1回の試行」で固定する。送信クリックのたびに新しいキーを作ると、
   * 応答だけ失われた再試行が別送信として届く（DEEP-10）。
   * 対象変更・成功・確定失敗のあとの新しい試行（beginAttempt）でのみ換える。
   */
  const keyRef = useRef<string | null>(null)
  // 送信中に対象が切り替わったら、戻ってきた応答を新しい対象の結果にしない。
  const generationRef = useRef(0)

  // 対象が変わったら、前の対象の試行・結果・冪等キーを持ち越さない。
  useEffect(() => {
    generationRef.current += 1
    keyRef.current = null
    setPhase({ kind: 'idle' })
  }, [reminderId])

  /**
   * 確認窓を開く＝新しい試行。ただし結果不明（unknown）の試行が残っている
   * ときは「届いたか分からない1回」の続きなので、同じ冪等キーを引き継ぐ。
   * それ以外（最初・成功後・確定失敗後）は別のテストとして新しいキーにする。
   */
  const beginAttempt = useCallback(() => {
    if (phase.kind !== 'unknown') {
      keyRef.current = crypto.randomUUID()
      setPhase({ kind: 'idle' })
    }
  }, [phase.kind])

  const send = useCallback(async (): Promise<ReminderTestSendOutcome> => {
    const targetId = reminderId
    if (!targetId) return { kind: 'unavailable' }
    if (!keyRef.current) keyRef.current = crypto.randomUUID()
    const key = keyRef.current
    const generation = generationRef.current
    setPhase({ kind: 'sending' })
    try {
      const response = await api.reminders.testDraft(targetId, key)
      if (generationRef.current !== generation) return { kind: 'stale' }
      if (!response.success) {
        const recipientFault =
          response.code === 'TEST_RECIPIENT_NOT_CONFIGURED' ||
          response.code === 'TEST_RECIPIENT_NOT_AVAILABLE'
        setPhase({
          kind: 'failed',
          message: response.error || 'テスト送信に失敗しました。LINE連携と通知内容を確認してください。',
        })
        return { kind: 'failed', recipientFault }
      }
      const data = response.data
      setPhase({ kind: 'succeeded', recipientName: data.recipientName, testedAt: data.testedAt })
      return { kind: 'succeeded', recipientName: data.recipientName, testedAt: data.testedAt }
    } catch {
      if (generationRef.current !== generation) return { kind: 'stale' }
      setPhase({
        kind: 'unknown',
        message: '送信結果を確認できませんでした。届いている可能性があります。この窓から再試行すれば、二重には送られません。',
      })
      return { kind: 'unknown' }
    }
  }, [reminderId])

  return { phase, beginAttempt, send }
}
