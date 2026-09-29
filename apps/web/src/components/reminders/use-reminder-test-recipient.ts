'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReminderTestRecipientStatus } from '@line-crm/shared'
import { api } from '@/lib/api'

/**
 * テスト送信先の表示用状態（N-070）。
 *
 * 未設定・設定済みだが届かない・読み込み失敗・送信できるを分ける。
 * 「読み込みの一瞬」と「本当に未設定」が同じ見た目にならないよう、
 * loading は別の種類にしておく。
 */
export type ReminderTestRecipientView =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'unset' }
  | { kind: 'unavailable' }
  /*
   * REMINDER-12: ready の送信先は「自分のLINE（self）」と「登録済み
   * テスト宛先（registered）」を区別する。文言はこの種別に合わせ、
   * 本人以外へ「自分のLINEへ」と名乗って送ることはない。
   */
  | {
      kind: 'ready'
      recipient: NonNullable<ReminderTestRecipientStatus['recipient']>
      recipientKind: 'self' | 'registered'
    }

/**
 * 下書きのテスト送信先を読む。`reminderId` が null の間は読まない。
 *
 * 遅い応答が前のリマインダ・前のアカウントの送信先で画面を上書きしないよう、
 * 呼び出しごとに世代を進め、戻ってきた時点で最新の世代だけを描く。
 */
export function useReminderTestRecipient(reminderId: string | null) {
  const [view, setView] = useState<ReminderTestRecipientView>({ kind: 'idle' })
  const generationRef = useRef(0)

  const reload = useCallback(async () => {
    if (!reminderId) return
    const generation = ++generationRef.current
    setView({ kind: 'loading' })
    try {
      const response = await api.reminders.getTestRecipient(reminderId)
      if (generationRef.current !== generation) return
      if (!response.success || !response.data) {
        setView({ kind: 'error' })
        return
      }
      const data = response.data
      if (data.state === 'ready' && data.recipient) {
        setView({
          kind: 'ready',
          recipient: data.recipient,
          // 種別が返らない古い応答は「自分のLINE」と名乗れないため登録宛先として扱う。
          recipientKind: data.recipientKind === 'self' ? 'self' : 'registered',
        })
      } else if (data.state === 'unavailable') {
        setView({ kind: 'unavailable' })
      } else {
        setView({ kind: 'unset' })
      }
    } catch {
      if (generationRef.current === generation) setView({ kind: 'error' })
    }
  }, [reminderId])

  useEffect(() => {
    // 対象が変わったら前の結果を持ち越さない。次の読み込みが終わるまでは
    // loading で出す（未設定と取り違えないため）。
    generationRef.current += 1
    setView(reminderId ? { kind: 'loading' } : { kind: 'idle' })
    void reload()
  }, [reminderId, reload])

  return { view, reload }
}
