'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, type BroadcastRecipientRow, type BroadcastRecipientsSummary } from '@/lib/api'
import Button from '@/components/shared/button'
import Chip, { type ChipTone } from '@/components/shared/chip'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import SelectField from '@/components/shared/select-field'

const RESULT_OPTIONS = [
  { value: 'all', label: 'すべて' },
  { value: 'delivered', label: '届いた' },
  { value: 'temporary', label: '一時的（送り直せる）' },
  { value: 'permanent', label: '届けられなかった' },
  { value: 'unknown', label: '送達不明' },
  { value: 'inflight', label: '送信中・送る前' },
] as const

const GROUP_TONE: Record<BroadcastRecipientRow['group'], ChipTone> = {
  delivered: 'ok',
  failed_temporary: 'warn',
  failed_permanent: 'danger',
  unknown: 'neutral',
  inflight: 'info',
}

function recipientCsv(rows: BroadcastRecipientRow[]): string {
  const cell = (value: string | number | null) => {
    const text = value == null ? '—' : String(value)
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  const lines = [
    ['名前', '結果', '理由', 'LINEの要求ID', '送った時刻', '結果が決まった時刻'],
    ...rows.map((row) => [
      row.displayName, row.label, row.detail, row.lineRequestId, row.dispatchedAt, row.settledAt,
    ]),
  ]
  return `\uFEFF${lines.map((line) => line.map(cell).join(',')).join('\r\n')}\r\n`
}

/**
 * 宛先のタブ（C-2）。誰に送ったか。
 *
 * 届いた・失敗の理由・送る前の件数を札で出し、宛先ごとに行に並べる。
 * 一時的な失敗だけを送り直せる。CSVに書き出せる。
 * 旧配信は集約だけ（行は捏造しない）。
 */
export default function BroadcastRecipients({
  broadcastId,
  total,
  version,
}: {
  broadcastId: string
  total: number
  /** 楽観ロックの版。再送・停止の競合を防ぐ。 */
  version: number
}) {
  const [result, setResult] = useState<string>('all')
  const [rows, setRows] = useState<BroadcastRecipientRow[] | null>(null)
  const [summary, setSummary] = useState<BroadcastRecipientsSummary | null>(null)
  const [aggregate, setAggregate] = useState<{ only: boolean; reason: 'all' | 'legacy' | null; legacySuccess: number | null }>({
    only: false, reason: null, legacySuccess: null,
  })
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [retryBusy, setRetryBusy] = useState(false)
  const [retryMessage, setRetryMessage] = useState<string | null>(null)
  const [csvBusy, setCsvBusy] = useState(false)

  const load = useCallback(async () => {
    setState('loading')
    setRetryMessage(null)
    try {
      const res = await api.broadcasts.recipients(broadcastId, { result, limit: 50 })
      if (!res.success || !res.data) {
        setState('error')
        return
      }
      setRows(res.data.rows)
      setSummary(res.data.summary)
      setAggregate({
        only: res.data.aggregateOnly,
        reason: res.data.aggregateReason,
        legacySuccess: res.data.legacySuccessCount,
      })
      setState('ready')
    } catch {
      setState('error')
    }
  }, [broadcastId, result])

  useEffect(() => {
    void load()
  }, [load])

  const handleRetry = useCallback(async () => {
    if (retryBusy) return
    setRetryBusy(true)
    setRetryMessage(null)
    try {
      const res = await api.broadcasts.retryFailed(broadcastId, version)
      if (!res.success) {
        setRetryMessage(res.error ?? '送り直せませんでした。')
        return
      }
      setRetryMessage(`${res.retryTargets ?? 0}人に送り直しを始めました。`)
      await load()
    } catch {
      setRetryMessage('送り直せませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setRetryBusy(false)
    }
  }, [broadcastId, load, retryBusy, version])

  const handleCsv = useCallback(async () => {
    if (csvBusy) return
    setCsvBusy(true)
    try {
      // いまの絞り込みの全件を取る（100件ずつ・10回まで）。
      const all: BroadcastRecipientRow[] = []
      let cursor: string | undefined
      for (let page = 0; page < 10; page += 1) {
        const res = await api.broadcasts.recipients(broadcastId, { result, cursor, limit: 100 })
        if (!res.success || !res.data) throw new Error('csv')
        all.push(...res.data.rows)
        if (!res.pagination?.nextCursor) break
        cursor = res.pagination.nextCursor
      }
      const url = URL.createObjectURL(new Blob([recipientCsv(all)], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `宛先-${broadcastId}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      setRetryMessage('CSVに書き出せませんでした。')
    } finally {
      setCsvBusy(false)
    }
  }, [broadcastId, csvBusy, result])

  if (state === 'error') {
    return <ListState kind="error" title="宛先を表示できませんでした" onRetry={() => void load()} />
  }
  if (state === 'loading' || rows === null || summary === null) {
    return <ListState kind="loading" title="宛先を読み込んでいます" />
  }

  if (aggregate.only) {
    return (
      <section aria-label="宛先" className="bg-canvas rounded-card border-hairline border p-5">
        <p className="text-ink text-sm font-semibold">宛先ごとの結果はありません</p>
        <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
          {aggregate.reason === 'all'
            ? '全員への配信は宛先の一覧を持ちません。'
            : `この配信は集約だけの古い記録です${aggregate.legacySuccess != null ? `（届いた ${aggregate.legacySuccess.toLocaleString('ja-JP')}人）` : ''}。`}
        </p>
      </section>
    )
  }

  const pending = summary.pending
  return (
    <section aria-label="宛先" className="bg-canvas rounded-card border-hairline space-y-4 border p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="ok">届いた {summary.sent.toLocaleString('ja-JP')}</Chip>
        <Chip tone="danger">失敗 {(summary.failedTemporary + summary.failedPermanent).toLocaleString('ja-JP')}</Chip>
        <Chip tone="neutral">送る前 {(pending ?? 0).toLocaleString('ja-JP')}</Chip>
        <HelpTip label="宛先の数の説明">
          届いた・失敗・送る前は宛先の台帳の数です。送る前はまだ送っていない人数で、名前の一覧はありません。
        </HelpTip>
      </div>

      {rows.length === 0 && result === 'all' ? (
        <ListState kind="empty" emptyPreset="readonly" title="宛先の結果はまだありません" />
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="text-ink-faint text-xs">
              絞り込み
              <SelectField
                aria-label="宛先の絞り込み"
                value={result}
                onChange={(event) => setResult(event.target.value)}
                options={RESULT_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                className="mt-1 block"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={handleRetry} disabled={retryBusy || summary.retryableCount === 0}>
                一時的な失敗 {summary.retryableCount.toLocaleString('ja-JP')}件を再送
              </Button>
              <Button variant="secondary" onClick={handleCsv} disabled={csvBusy}>
                CSVに書き出す
              </Button>
            </div>
          </div>
          {retryMessage ? <p className="text-ink-secondary text-xs">{retryMessage}</p> : null}
          {rows.length === 0 ? (
            <ListState kind="empty" emptyPreset="readonly" title="この絞り込みの宛先はありません" />
          ) : (
            <ul className="border-hairline divide-hairline divide-y rounded-control border">
              {rows.map((row) => (
                <li key={row.friendId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <p className="text-ink truncate text-sm font-medium" title={row.displayName}>
                    {row.displayName}
                  </p>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-ink-faint text-xs tabular-nums">
                      {row.settledAt ? formatTime(row.settledAt) : '—'}
                    </span>
                    <Chip tone={GROUP_TONE[row.group]}>{row.label}</Chip>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-ink-faint text-xs">
            {total > 0 ? `対象 ${total.toLocaleString('ja-JP')}人` : null}
            {pending != null && pending > 0 ? ` ・ 送る前 ${pending.toLocaleString('ja-JP')}人は名前の一覧がありません` : null}
          </p>
        </>
      )}
    </section>
  )
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}
