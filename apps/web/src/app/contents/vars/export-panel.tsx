'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type CommonVarExportJob } from '@/lib/api'
import Button from '@/components/shared/button'
import StatusBadge from '@/components/shared/status-badge'
import { formatJstDateTime } from '@/lib/presentation'

/*
 * 共通情報の監査付きCSV出力（N-192）。
 *
 * 以前は画面に読み込めた最大200件を端末でCSV化していた。ここでは
 * サーバの台帳へ依頼を残し、全件をページングして書き出した成果物を
 * 期限つきでダウンロードする。状態は読込中・書き出し中・完了・失敗・
 * 期限切れの5つを言い分ける。
 */

/** 完了・失敗・期限切れに届くまで状態を聞き直す間隔。 */
const POLL_INTERVAL_MS = 1_200
/** 「最近の書き出し」に出す件数。 */
const RECENT_LIMIT = 5

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

function statusTone(status: CommonVarExportJob['status']) {
  switch (status) {
    case 'completed': return 'success' as const
    case 'failed': return 'danger' as const
    case 'expired': return 'warning' as const
    default: return 'info' as const
  }
}

function statusLabel(status: CommonVarExportJob['status']) {
  switch (status) {
    case 'queued': return '待機中'
    case 'running': return '書き出し中'
    case 'completed': return '完了'
    case 'failed': return '失敗'
    case 'expired': return '期限切れ'
  }
}

export default function VarsExportPanel({ accountId, folderId, ungrouped = false }: {
  accountId: string | null
  /** 絞り込み中のフォルダ。null は「すべて」。 */
  folderId: string | null
  /** 「未分類」だけを対象にする絞り込み。 */
  ungrouped?: boolean
}) {
  const [jobs, setJobs] = useState<CommonVarExportJob[]>([])
  const [active, setActive] = useState<CommonVarExportJob | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState('')
  /** 遅れて返った別アカウントの結果を映さないための世代番号。 */
  const generationRef = useRef(0)

  const refresh = useCallback(async (targetAccountId: string, generation: number) => {
    try {
      const res = await api.commonVars.listExports(targetAccountId)
      if (generationRef.current !== generation) return
      if (res.success) setJobs(res.data)
    } catch {
      /* 履歴が読めなくても書き出し自体は止めない */
    }
  }, [])

  // アカウントが変わったら履歴を読み直し、進行中の表示をリセットする。
  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    setJobs([])
    setActive(null)
    setRequesting(false)
    setError('')
    if (!accountId) return
    void (async () => {
      try {
        const res = await api.commonVars.listExports(accountId)
        if (generationRef.current !== generation) return
        if (res.success) {
          setJobs(res.data)
          const latest = res.data[0]
          if (latest) setActive(latest)
        }
      } catch {
        /* 表示は一覧の下に出る補助。読めないときは何も出さない */
      }
    })()
  }, [accountId])

  // queued/running の間は状態を聞き直す。
  useEffect(() => {
    if (!active || (active.status !== 'queued' && active.status !== 'running')) return
    const generation = generationRef.current
    const timer = window.setInterval(async () => {
      try {
        const res = await api.commonVars.exportDetail(active.id)
        if (generationRef.current !== generation) return
        if (res.success) {
          setActive(res.data)
          if (res.data.status !== 'queued' && res.data.status !== 'running' && accountId) {
            void refresh(accountId, generation)
          }
        }
      } catch {
        /* 一時的な通信障害では監視を止めない */
      }
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [active, accountId, refresh])

  const start = async () => {
    if (!accountId || requesting) return
    const generation = generationRef.current
    setRequesting(true)
    setError('')
    try {
      const res = await api.commonVars.createExport({
        accountId,
        folderId: folderId ?? undefined,
        ungrouped: ungrouped || undefined,
      })
      if (generationRef.current !== generation) return
      if (!res.success) {
        setError(res.error || '書き出しを依頼できませんでした')
        return
      }
      setActive(res.data)
      void refresh(accountId, generation)
    } catch {
      if (generationRef.current === generation) {
        setError('書き出しを依頼できませんでした。接続を確かめて、もう一度お試しください。')
      }
    } finally {
      if (generationRef.current === generation) setRequesting(false)
    }
  }

  const regenerate = async (job: CommonVarExportJob) => {
    if (!accountId || requesting) return
    const generation = generationRef.current
    setRequesting(true)
    setError('')
    try {
      const res = await api.commonVars.regenerateExport(job.id)
      if (generationRef.current !== generation) return
      if (!res.success) {
        setError(res.error || 'もう一度書き出せませんでした')
        return
      }
      setActive(res.data)
      void refresh(accountId, generation)
    } catch {
      if (generationRef.current === generation) {
        setError('もう一度書き出せませんでした。接続を確かめて、もう一度お試しください。')
      }
    } finally {
      if (generationRef.current === generation) setRequesting(false)
    }
  }

  const running = active?.status === 'queued' || active?.status === 'running'

  return (
    <div className="flex flex-col items-end gap-2" data-testid="vars-export-panel">
      <Button
        type="button"
        variant="secondary"
        onClick={() => void start()}
        disabled={!accountId || requesting || running}
      >
        {requesting && !active ? '書き出しを依頼しています…' : 'CSVで書き出す'}
      </Button>

      {error ? (
        <div className="bg-danger-bg border-danger-bg text-danger rounded-control border px-4 py-2 text-sm" role="alert">
          {error}
        </div>
      ) : null}

      {active ? (
        <div
          className="border-hairline bg-canvas rounded-control min-w-80 border px-4 py-3 text-sm"
          aria-live="polite"
          data-testid="vars-export-status"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={statusTone(active.status)} size="compact">
              {statusLabel(active.status)}
            </StatusBadge>
            {running ? (
              <span className="text-ink-secondary">
                {active.processedCount.toLocaleString('ja-JP')}
                {' / '}
                {active.totalCount == null ? '…' : active.totalCount.toLocaleString('ja-JP')}
                件
              </span>
            ) : null}
            {active.status === 'completed' ? (
              <span className="text-ink-secondary">
                {(active.rowCount ?? 0).toLocaleString('ja-JP')}件
                （{formatJstDateTime(active.expiresAt)}まで）
              </span>
            ) : null}
            {active.status === 'failed' ? (
              <span className="text-danger">{active.failureReason ?? '書き出せませんでした'}</span>
            ) : null}
            {active.status === 'expired' ? (
              <span className="text-ink-secondary">ダウンロード期限が切れました</span>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {active.status === 'completed' && active.downloadUrl ? (
              <a
                className="text-action text-sm font-semibold hover:underline"
                href={`${API_BASE}${active.downloadUrl}`}
              >
                CSVをダウンロード
              </a>
            ) : null}
            {active.status === 'completed' || active.status === 'failed' || active.status === 'expired' ? (
              <button
                type="button"
                className="text-action text-sm font-semibold hover:underline disabled:opacity-40"
                disabled={requesting}
                onClick={() => void regenerate(active)}
              >
                もう一度書き出す
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {jobs.length > 1 ? (
        <details className="text-ink-secondary w-full text-xs">
          <summary className="cursor-pointer">最近の書き出し（{jobs.length}件）</summary>
          <ul className="border-hairline divide-hairline mt-1 divide-y rounded-control border">
            {jobs.slice(0, RECENT_LIMIT).map((job) => (
              <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  {formatJstDateTime(job.createdAt)}・{job.createdByName}
                  {job.rowCount != null ? `・${job.rowCount.toLocaleString('ja-JP')}件` : ''}
                </span>
                <span className="flex items-center gap-2">
                  <StatusBadge tone={statusTone(job.status)} size="compact">
                    {statusLabel(job.status)}
                  </StatusBadge>
                  {job.status === 'completed' && job.downloadUrl ? (
                    <a className="text-action font-semibold hover:underline" href={`${API_BASE}${job.downloadUrl}`}>
                      ダウンロード
                    </a>
                  ) : null}
                  {job.status === 'expired' ? (
                    <button
                      type="button"
                      className="text-action font-semibold hover:underline"
                      onClick={() => void regenerate(job)}
                    >
                      再生成
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
