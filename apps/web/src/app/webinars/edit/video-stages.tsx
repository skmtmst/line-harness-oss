'use client'

import { useCallback, useEffect, useState } from 'react'
import { webinarApi, type WebinarVideoAsset } from '@/lib/api'
import Button from '@/components/shared/button'
import HelpTip from '@/components/shared/help-tip'

/** N: 動画の準備の段（検査 → 変換 → 配信の形 → 表紙）。 */
const STAGES = [
  { key: 'uploaded', label: '受け付け' },
  { key: 'inspecting', label: '検査' },
  { key: 'converting', label: '変換' },
  { key: 'packaging', label: '配信の形' },
  { key: 'thumbnail', label: '表紙' },
  { key: 'ready', label: '準備完了' },
] as const

const NEXT_STAGE: Record<string, string[]> = {
  uploaded: ['inspecting', 'failed'],
  inspecting: ['converting', 'failed'],
  converting: ['packaging', 'failed'],
  packaging: ['thumbnail', 'failed'],
  thumbnail: ['ready', 'failed'],
  ready: [],
  failed: [],
}

const NEXT_LABEL: Record<string, string> = {
  inspecting: '検査へ進める',
  converting: '変換へ進める',
  packaging: '配信の形へ進める',
  thumbnail: '表紙へ進める',
  ready: '準備完了にする',
  failed: '失敗にする',
}

/**
 * N: 動画の準備の段を見る・進める。準備（ready）が済むまで公開できない。
 * 従来の動画（資産の行が無い）には出さない。
 */
export default function VideoStages({ webinarId, hasVideo, canEdit = true }: { webinarId: string; hasVideo: boolean; canEdit?: boolean }) {
  const [asset, setAsset] = useState<WebinarVideoAsset | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await webinarApi.videoAsset(webinarId)
      setAsset(res.data.asset)
    } catch {
      setAsset(undefined)
      setError('動画の準備を読み込めませんでした。')
    }
  }, [webinarId])

  useEffect(() => {
    if (hasVideo) void load()
  }, [hasVideo, load])

  const advance = async (stage: string) => {
    if (!canEdit || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await webinarApi.advanceVideoAsset(webinarId, { stage: stage as WebinarVideoAsset['stage'] })
      setAsset(res.data.asset)
    } catch {
      setError('段を進められませんでした。権限または段の順番を確認してください。')
    } finally {
      setBusy(false)
    }
  }

  if (!hasVideo) return null
  if (asset === undefined) {
    return error ? (
      <p className="text-ink-secondary mt-3 text-xs" role="alert">
        {error}
        <button type="button" onClick={() => void load()} className="ml-2 font-medium underline">
          もう一度読み込む
        </button>
      </p>
    ) : (
      <p className="text-ink-faint mt-3 text-xs">動画の準備を読み込んでいます…</p>
    )
  }
  if (asset === null) {
    return (
      <div className="mt-3">
        <Button onClick={() => void advance('uploaded')} disabled={busy || !canEdit} busy={busy} busyLabel="始めています…">動画の準備を始める
        </Button>
        {error ? <p className="text-danger mt-2 text-xs" role="alert">{error}</p> : null}
      </div>
    )
  }

  const stageIndex = STAGES.findIndex((stage) => stage.key === asset.stage)
  const nextStages = NEXT_STAGE[asset.stage] ?? []
  const ready = asset.stage === 'ready'

  return (
    <div className="mt-3">
      <div className="flex items-center gap-1.5">
        <p className="text-ink-faint text-xs font-semibold">動画の準備</p>
        <HelpTip label="動画の準備の説明">
          検査・変換・配信の形・表紙の段を通し、準備が済んだ動画だけ配信に選べます。
        </HelpTip>
      </div>
      <ol className="mt-2 flex flex-wrap items-center gap-1" aria-label="動画の準備の段">
        {STAGES.map((stage, index) => {
          const done = stageIndex >= 0 && index <= stageIndex
          const current = stage.key === asset.stage
          return (
            <li key={stage.key} className="flex items-center gap-1">
              {index > 0 && <span aria-hidden="true" className="text-ink-faint text-xs">›</span>}
              {/* className は静的に読める字面だけで書く（design-debt 計測のため）。 */}
              <span
                aria-current={current ? 'step' : undefined}
                className={
                  asset.stage === 'failed'
                    ? 'rounded-pill bg-danger-bg px-2 py-1 text-micro font-semibold text-danger'
                    : done
                      ? 'rounded-pill bg-success-bg px-2 py-1 text-micro font-semibold text-success'
                      : 'rounded-pill bg-canvas-sunken text-ink-faint px-2 py-1 text-micro font-semibold'
                }
              >
                {stage.label}
              </span>
            </li>
          )
        })}
        {asset.stage === 'failed' && (
          <li>
            <span className="rounded-pill bg-danger-bg text-danger px-2 py-1 text-micro font-semibold">
              失敗{asset.errorCode ? `（${asset.errorCode}）` : ''}
            </span>
          </li>
        )}
      </ol>
      {!ready && asset.stage !== 'failed' && (
        <p className="text-warning mt-2 text-xs">準備が済むまで公開できません。</p>
      )}
      {nextStages.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {nextStages.map((next) => (
            <Button key={next} onClick={() => void advance(next)} disabled={busy || !canEdit}>
              {NEXT_LABEL[next] ?? next}
            </Button>
          ))}
        </div>
      )}
      {error ? <p className="text-danger mt-2 text-xs" role="alert">{error}</p> : null}
    </div>
  )
}
