'use client'

import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { isCurrentPreviewRequest } from './bulk-preview-request'

interface Props {
  open: boolean
  scenarioId: string
  onClose: () => void
}

interface PreviewStep {
  stepOrder: number
  deliveryAt: string
  deliveryAtLabel: string
  messageType: string
  messageContent: string
}

function nowJstAsLocalInput(): string {
  // JST clock-time as YYYY-MM-DDTHH:MM for <input type="datetime-local">
  const d = new Date(Date.now() + 9 * 60 * 60_000)
  return d.toISOString().slice(0, 16)
}

export default function BulkPreviewModal({ open, scenarioId, onClose }: Props) {
  const [startAt, setStartAt] = useState(() => nowJstAsLocalInput())
  const [steps, setSteps] = useState<PreviewStep[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestGenerationRef = useRef(0)

  useEffect(() => {
    if (!open) return
    // 空のまま送ると NaN 時刻の予定が返る。空の間は取り直さない（#495 軽15）。
    if (!startAt) return
    setLoading(true)
    setError('')
    /*
     * 打つたびに取り直さない。300ms 待ってから1回だけ取り、
     * 待ちの間に次の入力が来たら古い応答は捨てる（#495 軽14）。
     * 友だち検索も 300ms 待ちが流儀。
     */
    const requestGeneration = ++requestGenerationRef.current
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const iso = startAt + ':00+09:00'
      api.scenarios
        .preview(scenarioId, iso, controller.signal)
        .then((res) => {
          if (!isCurrentPreviewRequest(requestGeneration, requestGenerationRef.current)) return
          if (res.success) setSteps(res.data.steps)
          else setError(res.error)
        })
        .catch((cause: unknown) => {
          if (cause instanceof Error && cause.name === 'AbortError') return
          if (isCurrentPreviewRequest(requestGeneration, requestGenerationRef.current)) {
            setError('プレビューの読み込みに失敗しました')
          }
        })
        .finally(() => {
          if (isCurrentPreviewRequest(requestGeneration, requestGenerationRef.current)) setLoading(false)
        })
    }, 300)
    return () => {
      if (isCurrentPreviewRequest(requestGeneration, requestGenerationRef.current)) {
        requestGenerationRef.current += 1
      }
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, scenarioId, startAt])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-canvas rounded-xl shadow-xl max-w-2xl w-full p-6 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-ink">一括プレビュー</h2>
          <button
            onClick={onClose}
            className="text-sm text-ink-faint hover:bg-canvas-sunken px-2 py-1 rounded"
          >
            ✕
          </button>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-medium text-ink-secondary mb-1">
            起点 (購読開始日時)
          </label>
          <input
            type="datetime-local"
            className="border border-hairline rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-danger mb-3">{error}</p>}

        {loading ? (
          <p className="text-sm text-ink-faint">読み込み中...</p>
        ) : steps && steps.length > 0 ? (
          <div className="space-y-2">
            {steps.map((s) => (
              <details
                key={s.stepOrder}
                className="border border-hairline rounded-lg p-3 group"
              >
                <summary className="cursor-pointer text-sm flex items-center gap-2 list-none">
                  <span className="font-mono text-ink-faint w-8">#{s.stepOrder}</span>
                  <span className="text-ink-secondary flex-1">{s.deliveryAtLabel}</span>
                  <span className="text-xs text-info">{s.messageType}</span>
                  <span className="text-ink-faint group-open:rotate-90 transition-transform">▶</span>
                </summary>
                <pre className="mt-2 text-xs text-ink-secondary whitespace-pre-wrap break-words bg-canvas-sunken p-2 rounded max-h-48 overflow-y-auto">
                  {s.messageContent}
                </pre>
              </details>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-faint">ステップがありません</p>
        )}

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-ink-secondary hover:bg-canvas-sunken rounded-lg"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
