'use client'

/*
 * 一斉配信の二者承認の見た目（m12a / 設計 A）。
 *
 * A-1 送る前の確認（承認する人の選択・ひとこと）
 * A-2 承認待ちの札・帯（依頼の取り消し・もう一度知らせる）
 * A-3 承認する人の操作（承認する人にだけ出す）
 * A-4 1人運用の人数の確認
 *
 * 既存の共有部品だけを使う。新しい見た目の決まりは作らない。
 * 緑の塗りボタンは置かない（押すボタンは呼び出し側の確認ダイアログが持つ）。
 */
import { useState } from 'react'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import HelpTip from '@/components/shared/help-tip'
import SelectField from '@/components/shared/select-field'
import { TextArea, TextField } from '@/components/shared/text-field'
import type {
  ApiBroadcast,
  BroadcastApprovalCandidate,
  BroadcastApprovalState,
} from '@/lib/api'

export type ApprovalStatus = NonNullable<ApiBroadcast['approvalStatus']>

function formatCount(n: number): string {
  return `${n.toLocaleString('ja-JP')}人`
}

function formatThreshold(n: number): string {
  return `${n.toLocaleString('ja-JP')}通`
}

/**
 * 承認まわりの日時（例：8月24日（月）10:00）。
 * 配信の確認で使う書き方にそろえる。壊れた値は「—」にする。
 */
export function formatApprovalDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('month')}月${get('day')}日（${get('weekday')}）${get('hour')}:${get('minute')}`
}

/** A-2 一覧の札。承認待ちと期限切れだけ出す。 */
export function ApprovalBadge({ status }: { status: ApprovalStatus | undefined }) {
  if (status === 'pending') return <Chip tone="info">承認待ち</Chip>
  if (status === 'expired') return <Chip tone="neutral">期限切れ</Chip>
  return null
}

/**
 * A-1 送る前の確認の中身。承認する人の選択とひとこと。
 * 押すボタンは持たない（確認ダイアログの「承認を依頼する」が押す）。
 */
export function ApprovalRequestFields({
  recipientCount,
  threshold,
  candidates,
  candidatesState,
  approverId,
  onApproverChange,
  note,
  onNoteChange,
}: {
  recipientCount: number
  threshold: number
  candidates: BroadcastApprovalCandidate[]
  candidatesState: 'loading' | 'ready' | 'error'
  approverId: string
  onApproverChange: (id: string) => void
  note: string
  onNoteChange: (note: string) => void
}) {
  return (
    <div className="bg-warning-bg rounded-control mt-3 p-3 text-xs leading-5">
      <p className="text-warning font-semibold">
        {formatThreshold(threshold)}以上なので、もう1人の承認が要ります。承認されるまで送られません。
      </p>
      <div className="mt-3 space-y-3">
        <div>
          <label htmlFor="approval-approver" className="text-ink mb-1 flex items-center gap-1 text-xs font-semibold">
            承認をお願いする人
            <HelpTip label="承認をお願いする人の説明">送る人とは別の人。</HelpTip>
          </label>
          {candidatesState === 'loading' ? (
            <p className="text-ink-faint text-xs">読み込んでいます…</p>
          ) : candidatesState === 'error' ? (
            <p className="text-danger text-xs">承認できる人を読み込めませんでした。開き直してください。</p>
          ) : (
            <SelectField
              id="approval-approver"
              className="w-full"
              value={approverId}
              onChange={(event) => onApproverChange(event.target.value)}
              options={[
                { value: '', label: candidates.length === 0 ? '承認できる人がいません' : '選んでください' },
                ...candidates.map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
          )}
          <p className="text-ink-faint mt-1 text-xs">
            送る相手 {formatCount(recipientCount)}。
          </p>
        </div>
        <div>
          <label htmlFor="approval-note" className="text-ink mb-1 block text-xs font-semibold">
            ひとこと（任意）
          </label>
          <TextArea
            id="approval-note"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="秋の案内です。10時までに見てください"
          />
        </div>
      </div>
    </div>
  )
}

/**
 * A-4 1人運用の人数の確認の中身。
 * 押すボタンは持たない（確認ダイアログの「送る」が押す）。
 */
export function SingleOperatorFields({
  recipientCount,
  value,
  onChange,
}: {
  recipientCount: number
  value: string
  onChange: (value: string) => void
}) {
  const entered = value.trim() === '' ? null : Number(value)
  const matched = entered !== null && Number.isInteger(entered) && entered === recipientCount
  return (
    <div className="mt-3">
      <p className="text-ink-secondary text-xs leading-5">
        間違いを防ぐため、送る相手の人数を入れてください。
      </p>
      <p className="text-ink-faint mt-3 text-center text-xs">送る相手</p>
      <p className="text-ink text-center text-2xl font-bold tabular-nums">
        {formatCount(recipientCount)}
      </p>
      <div className="mt-3">
        <label htmlFor="approval-count" className="text-ink mb-1 flex items-center gap-1 text-xs font-semibold">
          人数を入れる
          <HelpTip label="人数の説明">送る相手の人数。送信の直前に数えた数。</HelpTip>
        </label>
        <TextField
          id="approval-count"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, ''))}
          placeholder={String(recipientCount)}
        />
        {value.trim() !== '' ? (
          matched ? (
            <p className="text-success mt-1 text-xs">人数が合いました</p>
          ) : (
            <p className="text-danger mt-1 text-xs">人数が合いません。送る相手の数と一致させてください。</p>
          )
        ) : null}
      </div>
    </div>
  )
}

/**
 * A-2 承認待ちの帯（配信の詳細・一覧の上の帯）。
 * 依頼の取り消し・もう一度知らせるを持つ。承認済み・差し戻し・期限切れの
 * ひとこともここに出す（赤は使わない。件数は「—」にしないので人数は出す）。
 */
export function ApprovalStatusSection({
  approval,
  scheduledLabel,
  approverName,
  requesterName,
  viewer,
  onCancel,
  onRemind,
  busy,
  message,
}: {
  approval: BroadcastApprovalState['approval']
  scheduledLabel: string | null
  /** 承認する人の名前。分からないときは題を短くする。 */
  approverName: string | null
  /** 頼んだ人の名前。分からないときは依頼の行を出さない。 */
  requesterName: string | null
  viewer: BroadcastApprovalState['viewer']
  onCancel: () => void
  onRemind: () => void
  busy: boolean
  message: string | null
}) {
  if (approval.status === 'pending') {
    return (
      <section aria-label="承認待ち" className="bg-warning-bg rounded-card border-hairline border p-5">
        <p className="text-ink text-sm font-semibold">
          {approverName ? `${approverName}さんの承認を待っています` : '承認を待っています'}
        </p>
        {requesterName || approval.requestedAt ? (
          <p className="text-ink-secondary mt-1 text-xs leading-5">
            依頼：{requesterName ?? '—'} ・ {formatApprovalDateTime(approval.requestedAt)}
          </p>
        ) : null}
        <p className="text-ink-secondary mt-1 text-xs leading-5">
          承認されないまま{scheduledLabel ?? '送る時刻'}を過ぎると、送らずに期限切れになります。
        </p>
        {approval.note ? (
          <p className="text-ink-secondary mt-2 text-xs leading-5">ひとこと：{approval.note}</p>
        ) : null}
        {message ? <p className="text-danger mt-2 text-xs">{message}</p> : null}
        {viewer.isRequester ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onCancel} disabled={busy}>
              依頼を取り消す
            </Button>
            <Button variant="secondary" onClick={onRemind} disabled={busy}>
              もう一度知らせる
            </Button>
          </div>
        ) : null}
      </section>
    )
  }
  if (approval.status === 'rejected') {
    return (
      <section aria-label="差し戻し" className="bg-canvas rounded-card border-hairline border p-5">
        <p className="text-ink text-sm font-semibold">差し戻されました</p>
        <p className="text-ink-secondary mt-1 text-xs leading-5">
          理由：{approval.rejectReason || '—'}
        </p>
        <p className="text-ink-faint mt-1 text-xs leading-5">
          内容を直して、もう一度承認を依頼してください。
        </p>
      </section>
    )
  }
  if (approval.status === 'expired') {
    return (
      <section aria-label="期限切れ" className="bg-canvas rounded-card border-hairline border p-5">
        <p className="text-ink text-sm font-semibold">期限切れです</p>
        <p className="text-ink-secondary mt-1 text-xs leading-5">
          承認されないまま予約の時刻を過ぎたため、送っていません。送るには作り直してください。
        </p>
      </section>
    )
  }
  if (approval.status === 'approved') {
    return (
      <section aria-label="承認済み" className="bg-canvas rounded-card border-hairline border p-5">
        <p className="text-ink text-sm font-semibold">承認されています</p>
        <p className="text-ink-faint mt-1 text-xs leading-5">
          {scheduledLabel ? `${scheduledLabel}に送ります。` : '送る操作へ進めます。'}
        </p>
      </section>
    )
  }
  return null
}

/**
 * A-3 承認する人の操作。承認する人（頼まれた人）にだけ出す。
 * 自分が頼んだ配信は出さない（ボタンも理由も出さず、帯だけ出す）。
 */
export function ApproverSection({
  approval,
  viewer,
  requesterName,
  recipientCount,
  scheduledLabel,
  messageSummary,
  messageHref,
  onApprove,
  onReject,
  busy,
  message,
}: {
  approval: BroadcastApprovalState['approval']
  viewer: BroadcastApprovalState['viewer']
  requesterName: string | null
  /** 送る相手の人数（送信の直前に数えた数）。 */
  recipientCount: number
  /** 送る日時（「8月24日（月）10:00」の書き方）。予約なしは null。 */
  scheduledLabel: string | null
  /** メッセージの数（例：3通）。分からないときは null。 */
  messageSummary: string | null
  messageHref: string
  /** 承認して送る。承認のあと送る操作まで続ける（呼び出し側で順番に行う）。 */
  onApprove: () => void
  onReject: (reason: string) => void
  busy: boolean
  message: string | null
}) {
  const [rejectReason, setRejectReason] = useState('')
  if (approval.status !== 'pending' || !viewer.isApprover) return null
  return (
    <section aria-label="承認の依頼" className="bg-canvas rounded-card border-hairline border p-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-ink flex items-center gap-1 text-sm font-semibold">
          承認の依頼
          <HelpTip label="承認の依頼の説明">承認する人は中身を見てから決める。自分が頼んだ配信は承認できない。</HelpTip>
        </p>
        <Chip tone="info">あなたの確認待ち</Chip>
      </div>
      <p className="text-ink-secondary mt-1 text-xs leading-5">
        {requesterName ? `${requesterName}さんから` : ''}「内容を確かめて承認・差し戻しをしてください。」
        {approval.note ? `ひとこと：${approval.note}` : ''}
      </p>
      <dl className="bg-canvas-sunken rounded-control mt-3 space-y-1 p-3 text-xs leading-5">
        <div className="flex gap-2">
          <dt className="text-ink-faint w-20 shrink-0">送る相手</dt>
          <dd className="text-ink font-semibold tabular-nums">{recipientCount.toLocaleString('ja-JP')}人</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-ink-faint w-20 shrink-0">送る日時</dt>
          <dd className="text-ink whitespace-nowrap" title={scheduledLabel ?? undefined}>
            {scheduledLabel ?? '今すぐ送る'}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-ink-faint w-20 shrink-0">メッセージ</dt>
          <dd className="text-ink whitespace-nowrap" title={messageSummary ?? undefined}>
            {messageSummary ?? '—'}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs">
        <a href={messageHref} className="text-action font-medium hover:underline">
          メッセージの見本を開く
        </a>
      </p>
      <div className="mt-3">
        <label htmlFor="approval-reject-reason" className="text-ink mb-1 block text-xs font-semibold">
          差し戻すときの理由（差し戻すときは必須）
        </label>
        <TextArea
          id="approval-reject-reason"
          rows={2}
          maxLength={1000}
          value={rejectReason}
          onChange={(event) => setRejectReason(event.target.value)}
          placeholder="理由を入れてください"
        />
      </div>
      {message ? <p className="text-danger mt-2 text-xs">{message}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => onReject(rejectReason)}
          disabled={busy || rejectReason.trim() === ''}
          title={rejectReason.trim() === '' ? '差し戻すときは理由が要ります' : undefined}
        >
          差し戻す
        </Button>
        <Button variant="primary" onClick={onApprove} disabled={busy}>
          承認して送る
        </Button>
      </div>
    </section>
  )
}
