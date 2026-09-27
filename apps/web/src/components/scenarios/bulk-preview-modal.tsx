'use client'

import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import DateTimeField from '@/components/shared/date-time-field'
import Dialog from '@/components/shared/dialog'
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
  // JST clock-time as YYYY-MM-DDTHH:MM for DateTimeField
  const d = new Date(Date.now() + 9 * 60 * 60_000)
  return d.toISOString().slice(0, 16)
}

/**
 * シナリオの一括プレビュー（設計の見出しへ移した窓）。
 * 枠は共通の Dialog に寄せる。フォーカスの移動・Esc で閉じる・外側を押して
 * 閉じるは Dialog（useOverlayFocus）が持つ。ここは中身だけ書く。
 */
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
            setError('プレビューの読み込みに失敗しました。もう一度読み込んでください。')
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

  return (
    <Dialog
      open={open}
      title="一括プレビュー"
      description="起点からの各通の届く日時と内容の見本です。送りはしません。"
      onCancel={onClose}
    >
      <div className="mb-4">
        <label className="text-ink-secondary mb-1 block text-xs font-medium">
          起点 (購読開始日時)
        </label>
        <DateTimeField
          value={startAt}
          onChange={setStartAt}
          aria-label="起点（購読開始日時）"
        />
      </div>

      {error && <p className="text-danger mb-3 text-sm" role="alert">{error}</p>}

      {loading ? (
        <p className="text-ink-faint text-sm">読み込み中...</p>
      ) : steps && steps.length > 0 ? (
        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {steps.map((s) => (
            <details
              key={s.stepOrder}
              className="border-hairline group rounded-lg border p-3"
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
                <span className="text-ink-faint w-8 font-mono">#{s.stepOrder}</span>
                <span className="text-ink-secondary flex-1">{s.deliveryAtLabel}</span>
                <span className="text-info text-xs">{s.messageType}</span>
                <span className="text-ink-faint transition-transform group-open:rotate-90">▶</span>
              </summary>
              <pre className="bg-canvas-sunken text-ink-secondary mt-2 max-h-48 overflow-y-auto rounded p-2 text-xs break-words whitespace-pre-wrap">
                {s.messageContent}
              </pre>
            </details>
          ))}
        </div>
      ) : (
        <p className="text-ink-faint text-sm">ステップがありません</p>
      )}
    </Dialog>
  )
}
