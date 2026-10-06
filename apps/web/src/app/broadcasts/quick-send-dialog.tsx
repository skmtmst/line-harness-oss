'use client'

/*
 * ★V8 一斉配信 かんたんに送る（`P6vbxn`・小窓 640）。
 *
 * 本文だけ書いてすぐ送る・予約するための小窓。本文・相手・
 * いつ・人数の見込み・承認の順に並べる。1,000人以上に送るときは
 * 承認する人を選んで頼む。口は既存のものだけ使う
 * （create・preflight・send・approval.request・tags.list）。
 * 二重押し防止・失敗時の文は共通の窓に任せる。
 */
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { api, type BroadcastApprovalCandidate } from '@/lib/api'
import type { Tag } from '@line-crm/shared'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import Select from '@/components/shared/select'
import DateField from '@/components/shared/date-field'
import { TimeField } from '@/components/shared/date-time-field'
import { formatNumber } from '@/lib/format'

/** 承認を頼む境目（板の文どおり）。 */
const APPROVAL_THRESHOLD = 1000
const TEXT_LIMIT = 5000

export default function QuickSendDialog({
  open,
  accountId,
  onClose,
  onSent,
}: {
  open: boolean
  accountId: string | null
  onClose: () => void
  /** 送った・予約した・承認を頼んだあと、一覧を読み直す。 */
  onSent: () => void
}) {
  const [text, setText] = useState('')
  const [target, setTarget] = useState<'all' | 'tag'>('all')
  const [tags, setTags] = useState<Tag[]>([])
  const [tagId, setTagId] = useState('')
  const [when, setWhen] = useState<'now' | 'scheduled'>('now')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('10:00')
  const [estimate, setEstimate] = useState<{ count: number; blocked: number } | null>(null)
  const [estimating, setEstimating] = useState(false)
  const [candidates, setCandidates] = useState<BroadcastApprovalCandidate[]>([])
  const [approverId, setApproverId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const estimateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 開いたら入力を空に戻し、タグと承認する人の候補を読む。
  useEffect(() => {
    if (!open) return
    setText('')
    setTarget('all')
    setTagId('')
    setWhen('now')
    setDate('')
    setTime('10:00')
    setEstimate(null)
    setApproverId('')
    setBusy(false)
    setError(null)
    if (!accountId) return
    void api.tags.list({ accountId }).then((res) => {
      if (res.success) setTags(res.data)
    }).catch(() => undefined)
    void api.broadcasts.approval.candidates(accountId).then((res) => {
      if (res.success) setCandidates(res.data)
    }).catch(() => undefined)
  }, [open, accountId])

  // 本文・相手が変わったら人数を見積もる（少し待ってから1回だけ）。
  useEffect(() => {
    if (!open || !accountId) return
    if (estimateTimer.current) clearTimeout(estimateTimer.current)
    if (!text.trim()) {
      setEstimate(null)
      return
    }
    estimateTimer.current = setTimeout(() => {
      void (async () => {
        setEstimating(true)
        try {
          const res = await api.broadcasts.preflight({
            targetType: target === 'tag' ? 'tag' : 'all',
            targetTagId: target === 'tag' ? tagId || null : null,
            lineAccountId: accountId,
            messageContent: text,
            messageCount: 1,
          })
          if (res.success) {
            setEstimate({ count: res.data.audienceCount, blocked: res.data.hiddenExcluded })
          }
        } catch {
          // 見積もれなくても入力は続けられる。送る前に止めない。
        } finally {
          setEstimating(false)
        }
      })()
    }, 500)
    return () => {
      if (estimateTimer.current) clearTimeout(estimateTimer.current)
    }
  }, [open, accountId, text, target, tagId])

  const needsApproval = (estimate?.count ?? 0) >= APPROVAL_THRESHOLD
  const scheduledAt = when === 'scheduled' && date ? `${date}T${time || '10:00'}:00` : null
  const canSend = text.trim().length > 0
    && text.length <= TEXT_LIMIT
    && (target === 'all' || tagId !== '')
    && (when === 'now' || date !== '')
    && (!needsApproval || approverId !== '')
    && !busy

  async function handleSend() {
    if (!canSend || !accountId) return
    setBusy(true)
    setError(null)
    try {
      const created = await api.broadcasts.create({
        title: text.trim().slice(0, 20) || 'かんたん送信',
        messageType: 'text',
        messageContent: text,
        targetType: target === 'tag' ? 'tag' : 'all',
        targetTagId: target === 'tag' ? tagId : null,
        scheduledAt,
        status: scheduledAt ? 'scheduled' : 'draft',
        lineAccountId: accountId,
      })
      if (!created.success) throw new Error(created.error ?? '作成失敗')
      const id = created.data.id
      if (needsApproval) {
        const requested = await api.broadcasts.approval.request(id, { approverStaffId: approverId })
        if (!requested.success) throw new Error(requested.error)
      } else if (!scheduledAt) {
        const sent = await api.broadcasts.send(id)
        if (!sent.success) throw new Error(sent.error)
      }
      onSent()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '送れませんでした。もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      designNode="P6vbxn"
      title="かんたんに送る"
      error={error ?? undefined}
      onCancel={() => { if (!busy) onClose() }}
      footer={(
        <div className="flex w-full flex-wrap items-center gap-2">
          <Link href="/broadcasts/new" className="text-action mr-auto text-sm font-semibold hover:underline">
            詳しく作るへ
          </Link>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            キャンセル
          </Button>
          <Button type="button" variant="primary" onClick={() => void handleSend()} disabled={!canSend} busy={busy} busyLabel="送っています…">
            {needsApproval ? '承認を頼む' : '送る'}
          </Button>
        </div>
      )}
    >
      <label className="text-ink-secondary mb-1 block text-sm font-medium" htmlFor="quick-send-text">
        本文
      </label>
      <textarea
        id="quick-send-text"
        className="border-hairline bg-canvas text-ink min-h-24 w-full rounded-control border p-3 text-sm"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={4}
      />
      <p className="text-ink-faint mt-1 flex items-center justify-between text-xs">
        <span>
          差し込み：
          <button
            type="button"
            className="text-action font-semibold hover:underline"
            onClick={() => setText((prev) => `${prev}{名前}`)}
          >
            名前
          </button>
        </span>
        <span>{text.length} / {TEXT_LIMIT.toLocaleString()}</span>
      </p>

      <p className="text-ink-secondary mb-1 mt-4 block text-sm font-medium">送る相手</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="送る相手">
        {([
          ['all', '友だち全員'],
          ['tag', 'タグで絞る'],
        ] as const).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            variant={target === value ? 'primary' : 'secondary'}
            onClick={() => setTarget(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      {target === 'tag' && (
        <div className="mt-2">
          <Select
            aria-label="タグ"
            value={tagId}
            onChange={(value) => setTagId(value)}
            options={[{ value: '', label: 'タグを選ぶ' }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))]}
          />
        </div>
      )}

      <p className="text-ink-secondary mb-1 mt-4 block text-sm font-medium">いつ</p>
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="いつ送るか">
        {([
          ['now', '今すぐ'],
          ['scheduled', '日時を決める'],
        ] as const).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            variant={when === value ? 'primary' : 'secondary'}
            onClick={() => setWhen(value)}
          >
            {label}
          </Button>
        ))}
        {when === 'scheduled' && (
          <span className="flex flex-wrap items-center gap-2">
            <DateField value={date} onChange={setDate} aria-label="送る日" />
            <TimeField value={time} onChange={setTime} aria-label="送る時刻" />
          </span>
        )}
      </div>

      <p className="text-ink-secondary mt-4 text-xs" aria-live="polite">
        {estimating
          ? '人数を数えています…'
          : estimate
            ? `${formatNumber(estimate.count)}人に届く見込み（ブロック中${formatNumber(estimate.blocked)}人を除く）`
            : '本文を書くと届く人数の見込みが出ます'}
      </p>

      {needsApproval && (
        <div className="bg-warning-bg mt-3 rounded-control p-3">
          <p className="text-ink text-xs font-semibold">
            {formatNumber(estimate?.count ?? 0)}人以上に送るときは承認が要ります。承認する人を選んで頼んでください。
          </p>
          <div className="mt-2">
            <Select
              aria-label="承認する人"
              value={approverId}
              onChange={(value) => setApproverId(value)}
              options={[{ value: '', label: '承認する人' }, ...candidates.map((item) => ({ value: item.id, label: item.name }))]}
            />
          </div>
          <p className="text-ink-secondary mt-2 text-xs">
            1人で運用しているときは、人数を確かめるチェックだけで送れます。
          </p>
        </div>
      )}
    </Dialog>
  )
}
