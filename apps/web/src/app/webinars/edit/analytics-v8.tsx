'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import { ApiError, downloadApiFile, webinarApi, type WebinarAnalytics } from '@/lib/api'
import type { ParticipantExport } from './participants-v8'
import AnalyticsFunnelV8 from './analytics-funnel-v8'
import RetentionSection from './retention-section'

export default function AnalyticsV8({ webinarId, durationSeconds, analytics, analyticsState, onRetry, onExportChange }: {
  webinarId: string
  durationSeconds: number
  analytics: WebinarAnalytics | null
  analyticsState: 'idle' | 'loading' | 'ready' | 'error'
  onRetry: () => void
  onExportChange: (value: ParticipantExport | null) => void
}) {
  const [permission, setPermission] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const locked = useRef(false)

  useEffect(() => {
    const request = ++generation.current
    setPermission('loading')
    setError('')
    // 集計の権限と、個人情報を含むCSVの権限は別。許可が確認できるまで出口を出さない。
    void webinarApi.participants(webinarId, undefined, 1).then((response) => {
      if (!Array.isArray(response.data.items)) throw new Error('invalid_participants')
      if (request === generation.current) setPermission('ready')
    }).catch((cause) => {
      if (request === generation.current) setPermission(cause instanceof ApiError && cause.status === 403 ? 'denied' : 'error')
    })
    return () => { generation.current += 1 }
  }, [webinarId, attempt])

  const download = useCallback(() => {
    if (permission !== 'ready' || locked.current) return
    const request = generation.current
    locked.current = true
    setBusy(true)
    setError('')
    void downloadApiFile(webinarApi.participantsCsvUrl(webinarId), 'webinar-participants.csv').catch((cause) => {
      if (request !== generation.current) return
      if (cause instanceof ApiError && cause.status === 403) {
        setPermission('denied')
        setError('参加者のCSVを書き出す権限がありません。管理者に確認してください。')
      } else setError('CSVを書き出せませんでした。通信を確認して、もう一度お試しください。')
    }).finally(() => {
      locked.current = false
      if (request === generation.current) setBusy(false)
    })
  }, [permission, webinarId])

  useEffect(() => {
    onExportChange({ download, busy, available: permission === 'ready' && analyticsState === 'ready' })
    return () => onExportChange(null)
  }, [onExportChange, download, busy, permission, analyticsState])

  if (analyticsState === 'error') return <Notice tone="info" action={<Button onClick={onRetry}>もう一度読み込む</Button>}>分析データを読み込めませんでした。通信を確認してください。</Notice>
  if (!analytics) return <p className="text-ink-faint text-sm" role="status">分析データを読み込んでいます…</p>

  return <div data-design-node="z2dgw" data-webinar-analytics>
    {permission === 'error' ? <Notice tone="info" action={<Button onClick={() => setAttempt((value) => value + 1)}>もう一度読み込む</Button>}>CSVを書き出す権限を確認できませんでした。分析の集計は表示しています。</Notice> : error ? <Notice tone="info">{error}</Notice> : null}
    <AnalyticsFunnelV8 summary={analytics.summary} daily={analytics.daily} />
    <RetentionSection retention={analytics.retention ?? { bucketSeconds: 60, started: 0, points: [] }} completed={analytics.summary.completed} ctaAtSeconds={analytics.ctaAtSeconds ?? null} heartbeatRejects={analytics.heartbeatRejects ?? 0} durationSeconds={durationSeconds} />
  </div>
}
