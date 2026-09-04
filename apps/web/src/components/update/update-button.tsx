'use client'

import { useState } from 'react'
import { startUpdate } from '@/lib/update-client'
import { ProgressModal } from './progress-modal'

/**
 * Kicks off an update via `POST /admin/update/start` and mounts a
 * ProgressModal bound to the returned updateId. The modal manages its own
 * SSE/polling lifecycle and calls `onClose` when the operator dismisses it.
 */
export function UpdateButton({ targetVersion }: { targetVersion: string }) {
  const [loading, setLoading] = useState(false)
  const [updateId, setUpdateId] = useState<string | null>(null)
  /**
   * 失敗の理由。**`alert()` の代わりに画面へ残す。**
   * 消えると原因を確かめ直せないし、画像比較にも写らない。
   */
  const [error, setError] = useState('')

  async function onClick() {
    setLoading(true)
    try {
      const r = await startUpdate()
      setUpdateId(r.updateId)
    } catch (e) {
      // **内部語を出さない。** `update failed:` は運用者の言葉ではない。
      setError(e instanceof Error ? e.message : 'アップデートを始められませんでした。しばらくおいてから、もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setError(''); void onClick() }}
        disabled={loading}
        className="text-sm px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? '開始中...' : `v${targetVersion} にアップデート`}
      </button>
      {error && (
        <p role="alert" className="text-danger mt-2 text-xs">{error}</p>
      )}
      {updateId && (
        <ProgressModal
          updateId={updateId}
          onClose={() => setUpdateId(null)}
        />
      )}
    </>
  )
}
