'use client'

import { useCallback, useState } from 'react'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import { describeApiFailure } from '@/components/shared/api-error-message'
import { ApiError, type GettingStartedStarter } from '@/lib/api'
import { styleApi } from '@/lib/api/helpers/styles'

/*
 * 初期セットが入っていない時の帯（SPEC-11 1-3）。スタイルは保存されたのに初期セットが 0 件のアカウントで、
 * 閉じて戻った後にもやり直せるようにする。判定は Worker の starter.applied だけで、画面で別の印を持たない。
 * ［入れ直す］は足りない物だけを止めた状態で入れる口を呼ぶ。何度押しても二重には入らない。
 */

const CONFLICT = 'ほかの人が先にスタイルを変えました。読み直したので、もう一度お試しください。'

/** 帯を出すか。入れた後の知らせは、読み直しで starter が変わっても残す。 */
export function starterRetryVisible(starter: GettingStartedStarter | null, inserted: number | null): boolean {
  return inserted !== null || (starter?.applied === false && starter.missing !== 0)
}

/** 入れた数をアカウントごとに覚える。読み直しの間（starter が null）も知らせを消さないため、帯の外に持つ。 */
export function useStarterRetryResult(accountId: string | null) {
  const [result, setResult] = useState<{ accountId: string; inserted: number } | null>(null)
  const record = useCallback((inserted: number) => { if (accountId) setResult({ accountId, inserted }) }, [accountId])
  const clear = useCallback(() => setResult(null), [])
  return { inserted: result && result.accountId === accountId ? result.inserted : null, record, clear }
}

export function StarterRetryNotice({ accountId, starter, version, inserted, onInserted, onDismiss, onChanged }: {
  accountId: string
  starter: GettingStartedStarter | null
  /** 今のスタイルの版。入れ直しの口は版が違うと何も入れない。読めるまでは null で、押せる形にしない。 */
  version: number | null
  /** 入れた数（まだ押していなければ null）。 */
  inserted: number | null
  onInserted: (inserted: number) => void
  onDismiss: () => void
  /** 入れた後・版が変わっていた時に、はじめにやることと使い方の設定を読み直す。 */
  onChanged: () => void
}) {
  const [error, setError] = useState('')
  if (inserted !== null) {
    return (
      <Notice tone="success" role="status" onClose={onDismiss}
        message={inserted > 0 ? `初期セットを ${inserted} 件入れました。送る物は止めた状態で入っています。` : '入れる物は残っていませんでした。'} />
    )
  }
  if (!starter || !starterRetryVisible(starter, null)) return null
  const retry = async () => {
    if (version === null) return
    setError('')
    try {
      const res = await styleApi.ensureStarterItems(accountId, version)
      if (!res.success) throw new Error('starter_ensure_failed')
      onInserted(res.data.inserted.length)
      onChanged()
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'version_conflict') {
        setError(CONFLICT)
        onChanged()
        return
      }
      setError(describeApiFailure(caught, '入れ直し'))
    }
  }
  return (
    <Notice
      tone="warn"
      role="status"
      heading="初期セットが入っていません"
      action={starter.missing === null || version === null ? undefined : <Button onClick={retry} busyLabel="入れています…">入れ直す</Button>}
    >
      {error || (starter.missing === null
        ? '統括の初期セットを読めなかったため、ここでは入れ直せません。統括の初期セットの画面で確かめてください。'
        : `あいさつ・リッチメニューなど ${starter.missing} 件が入っていません。［入れ直す］で足りない物だけを止めた状態で入れます。`)}
    </Notice>
  )
}
