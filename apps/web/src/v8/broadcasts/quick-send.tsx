'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ListOrdered, Send, Users } from 'lucide-react'
import type { Tag } from '@line-crm/shared'
import { api, type BroadcastApprovalCandidate } from '@/lib/api'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import { SingleOperatorFields } from '@/components/broadcasts/broadcast-approval'
import Select from '@/components/shared/select'
import { EntityKindField } from '@/components/shared/entity-picker-sources'
import DateTimeField from '@/components/shared/date-time-field'
import { formatNumber } from '@/lib/format'
import { datetimeLocalJstToUtcIso } from '@/lib/jst-datetime'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import styles from './quick-send.module.css'
import InsertTextField, { type InsertTextFieldHandle } from '@/components/shared/insert-text-field'
import { Field } from '@/components/shared/form-controls'
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'
import EntitySelect, { entityOptionMetadata } from '@/components/shared/entity-select'

/*
 * ★V8 一斉配信 かんたんに送る（板 `P6vbxn`・小窓 640）。
 *
 * 今の部品（app/broadcasts/quick-send-dialog.tsx。一覧から開く口が無かった）の動きを写して一から書いた。
 * 本文・相手・いつ・人数の見込み・承認の順。1,000人以上に送るときは承認する人を選んで頼む。
 * 口は今と同じ（tags.list・approval.candidates・preflight・create・send・approval.request）。
 * 入口：一斉配信一覧の「配信を作る ▾」の「かんたんに送る」（絵 `Xr6eu` の分け方）。
 */

/** 承認を頼む境目（絵の文どおり）。 */
/** 「名前」を押して入る文字。送るときに友だちの名前へ置き換わる形（{{name}}）。 */
export const QUICK_SEND_NAME_TOKEN = '{{name}}'
export const APPROVAL_THRESHOLD = 1000
export const TEXT_LIMIT = 5000
const ROLE_LABELS: Record<string, string> = { owner: 'オーナー', admin: '管理者', staff: 'スタッフ' }

type Estimate = { count: number; blocked: number; remaining: number | null }

/** 見込みの1文。今月の残りが読めたときだけ足す。 */
export function estimateText(estimate: Estimate): string {
  const base = `${formatNumber(estimate.count)} 人に届く見込み（ブロック中 ${formatNumber(estimate.blocked)} 人を除く）`
  return estimate.remaining === null ? base : `${base}・今月あと ${formatNumber(estimate.remaining)} 通 送れます`
}

export default function QuickSendV8({
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
  const saveErrors = useSaveFormErrors()
  const [text, setText] = useState('')
  const [target, setTarget] = useState<'all' | 'tag'>('all')
  const [tags, setTags] = useState<Tag[]>([])
  const [tagId, setTagId] = useState('')
  const [when, setWhen] = useState<'now' | 'scheduled'>('now')
  const [scheduledValue, setScheduledValue] = useState('')
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [estimating, setEstimating] = useState(false)
  const [candidates, setCandidates] = useState<BroadcastApprovalCandidate[]>([])
  const [approverId, setApproverId] = useState('')
  const [approvalConfig, setApprovalConfig] = useState<{threshold: number; singleOperator: boolean} | null>(null)
  const [countInput, setCountInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const estimateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<{ id: string; scheduledAt: string | null; needsApproval: boolean } | null>(null)
  const sendingRef = useRef(false)
  const [pending, setPending] = useState(false)
  const guard = useUnsavedGuard({ dirty: open && (text !== '' || scheduledValue !== ''), busy, onDiscard: onClose })
  const textRef = useRef<InsertTextFieldHandle | HTMLTextAreaElement | null>(null)

  // 開いたら入力を空に戻し、タグと承認する人の候補を読む。
  useEffect(() => {
    let cancelled = false
    if (!open) return
    setApprovalConfig(null)
    setCountInput('')
    setTags([])
    setCandidates([])
    pendingRef.current = null
    sendingRef.current = false
    setPending(false)
    setText('')
    setTarget('all')
    setTagId('')
    setWhen('now')
    setScheduledValue('')
    setEstimate(null)
    setApproverId('')
    setBusy(false)
    setError(null)
    if (!accountId) return
    void api.tags.list({ accountId }).then((res) => {
      if (!cancelled && res.success) setTags(res.data)
    }).catch(() => undefined)
    void api.broadcasts.approval.candidates(accountId).then((res) => {
      if (!cancelled && res.success) setCandidates(res.data)
    }).catch(() => undefined)
    void api.broadcasts.approval.config(accountId).then((res) => { if (cancelled) return; if (res.success) setApprovalConfig(res.data); else setError('承認の設定を読み込めませんでした。開き直してください。') }).catch(() => { if (!cancelled) setError('承認の設定を読み込めませんでした。開き直してください。') })
    return () => { cancelled = true }
  }, [open, accountId])

  // 本文・相手が変わったら人数を見積もる（少し待ってから1回だけ）。
  useEffect(() => {
    let cancelled = false
    setEstimate(null)
    setCountInput('')
    setEstimating(false)
    if (!open || !accountId) return
    if (estimateTimer.current) clearTimeout(estimateTimer.current)
    if (!text.trim() || (target === 'tag' && !tagId)) {
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
          if (!cancelled && res.success) {
            setEstimate({ count: res.data.audienceCount, blocked: res.data.hiddenExcluded, remaining: res.data.quota?.remaining ?? null })
          }
        } catch (saveFailure) {
          saveErrors.capture(saveFailure)
          // 見積もれなくても入力は続けられる。送る前に止めない。
        } finally {
          if (!cancelled) setEstimating(false)
        }
      })()
    }, 500);

    return () => {
      cancelled = true
      if (estimateTimer.current) clearTimeout(estimateTimer.current)
    }
  }, [open, accountId, text, target, tagId, saveErrors])

  const needsCountConfirmation = estimate !== null && approvalConfig !== null && estimate.count >= approvalConfig.threshold && approvalConfig.singleOperator
  const needsApproval = estimate !== null && approvalConfig !== null && estimate.count >= approvalConfig.threshold && !approvalConfig.singleOperator
  const countMatched = countInput.trim() !== '' && Number(countInput) === estimate?.count
  const scheduledAt = when === 'scheduled' && scheduledValue ? datetimeLocalJstToUtcIso(scheduledValue) : null
  const canSend = text.trim().length > 0
    && text.length <= TEXT_LIMIT
    && (target === 'all' || tagId !== '')
    && (when === 'now' || scheduledValue !== '')
    && (!needsApproval || approverId !== '')
    && approvalConfig !== null
    && estimate !== null
    && (!needsCountConfirmation || countMatched)
    && !busy

  /** 差し込む：今のカーソルの位置に {{name}} を入れる（送るときに名前へ置き換わる形。{名前} は置き換わらずに届いていた）。 */
  const insertName = () => {
    const el = textRef.current
    const token = QUICK_SEND_NAME_TOKEN
    if (!el) return setText((prev) => `${prev}${token}`)
    const start = el.selectionStart ?? text.length
    const end = el.selectionEnd ?? text.length
    setText(`${text.slice(0, start)}${token}${text.slice(end)}`)
  }

  async function handleSend() {
    if (!canSend || !accountId || sendingRef.current) return
    sendingRef.current = true
    setBusy(true)
    setError(null)
    try {
      let attempt = pendingRef.current
      if (attempt) {
        // 応答だけを失った場合は実物を読み、既に始まった送信・承認依頼を繰り返さない。
        const current = await api.broadcasts.get(attempt.id)
        if (!current.success) throw new Error(current.error ?? '配信の状態を確認できませんでした')
        if (current.data.status === 'sent' || current.data.status === 'sending'
          || (attempt.needsApproval && current.data.approvalStatus === 'pending')) {
          guard.disarm()
          onSent()
          onClose()
          return
        }
      }
      if (needsCountConfirmation) {
        const current = await api.broadcasts.preflight({
          targetType: target === 'tag' ? 'tag' : 'all',
          targetTagId: target === 'tag' ? tagId : null,
          lineAccountId: accountId,
          messageContent: text,
          messageCount: 1,
        })
        if (!current.success) throw new Error(current.error || '現在の人数を確認できませんでした')
        if (current.data.audienceCount !== Number(countInput)) {
          setEstimate({ count: current.data.audienceCount, blocked: current.data.hiddenExcluded, remaining: current.data.quota?.remaining ?? null })
          setCountInput('')
          setError('対象人数が変わりました。現在の人数を確認して、もう一度入力してください。')
          return
        }
      }
      if (!attempt) {
        const created = await api.broadcasts.create({
          title: text.trim().slice(0, 20) || 'かんたん送信',
          messageType: 'text',
          messageContent: text,
          targetType: target === 'tag' ? 'tag' : 'all',
          targetTagId: target === 'tag' ? tagId : null,
          scheduledAt,
          status: scheduledAt ? 'scheduled' : 'draft',
          lineAccountId: accountId,
          ...(needsCountConfirmation ? { confirmedRecipientCount: Number(countInput) } : {}),
        })
        if (!created.success) throw new Error(created.error ?? '作れませんでした')
        attempt = { id: created.data.id, scheduledAt, needsApproval }
        pendingRef.current = attempt
        setPending(true)
      }
      const id = attempt.id
      if (attempt.needsApproval) {
        const requested = await api.broadcasts.approval.request(id, { approverStaffId: approverId })
        if (!requested.success) throw new Error(requested.error)
      } else if (!attempt.scheduledAt) {
        const sent = await api.broadcasts.send(id, needsCountConfirmation ? { confirmedRecipientCount: Number(countInput) } : undefined)
        if (!sent.success) throw new Error(sent.error)
      }
      guard.disarm()
      onSent()
      onClose()
    } catch (e) {
      const fieldFailure = saveErrors.capture(e)

      { if (!fieldFailure)


      setError(e instanceof Error ? e.message : '送れませんでした。もう一度お試しください。') }
    } finally {
      sendingRef.current = false
      setBusy(false)
    }
  }

  const sendLabel = needsApproval ? '承認を頼む' : scheduledAt ? '予約する' : '送る'

  return (
    <SaveErrorScope errors={saveErrors}><>
    <Dialog
      open={open}
      confirmation
      designNode="P6vbxn"
      designWidth={640}
      title="かんたんに送る"
      error={error ?? undefined}
      busy={busy}
      onCancel={() => { if (!busy) onClose() }}
      footer={(
        <div className={styles.footer}>
          <Link href="/broadcasts/new" className={styles.detailLink}>
            <ListOrdered size={15} aria-hidden="true" />
            詳しく作るへ
          </Link>
          <span className={styles.spacer} aria-hidden="true" />
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>キャンセル</Button>
          <Button type="button" variant="primary" onClick={() => void handleSend()} disabled={!canSend} busy={busy} busyLabel="送っています…">
            <Send size={15} aria-hidden="true" />{sendLabel}
          </Button>
          <span className={styles.spacer} aria-hidden="true" />
          {/* 左の「詳しく作るへ」と釣り合いを取り、キャンセル・送るを窓の真ん中に置く。 */}
          <span className={styles.balance} aria-hidden="true" />
        </div>
      )}
    >
      <div className={styles.body}><Field label="本文" htmlFor="quick-send-v8-text"><SaveErrorField names={["text","messageContent"]}><InsertTextField
          id="quick-send-v8-text"
          ref={textRef}
          className={styles.textarea}
          value={text}
          maxLength={TEXT_LIMIT}
          disabled={busy || pending}
          onValueChange={(next) => setText(next)}
        /></SaveErrorField>
<div className={styles.metaRow}>
          <span className={styles.meta}>差し込む：</span>
          <button type="button" className={styles.insert} disabled={busy || pending} onClick={insertName}>名前</button>
          <span className={styles.spacer} aria-hidden="true" />
          <span className={styles.meta}>{`${formatNumber(text.length)} / ${formatNumber(TEXT_LIMIT)}`}</span>
        </div>
<p className={styles.label} id="quick-send-v8-target">送る相手</p>
<div className={styles.chips} role="radiogroup" aria-labelledby="quick-send-v8-target">
          {([['all', '友だち全員'], ['tag', 'タグで絞る']] as const).map(([value, label]) => (
            <button key={value} type="button" role="radio" disabled={busy || pending} aria-checked={target === value} className={styles.chip} onClick={() => setTarget(value)}>
              {label}
            </button>
          ))}
          {target === 'tag' ? (
            <div className={styles.tagPick}>
              <SaveErrorField names={["tagId"]}><EntityKindField kind="tag" label="タグ" disabled={busy || pending} value={tagId} onChange={setTagId} options={tags} /></SaveErrorField>
            </div>
          ) : null}
        </div>
<p className={styles.label} id="quick-send-v8-when">いつ</p>
<div className={styles.chips} role="radiogroup" aria-labelledby="quick-send-v8-when">
          {([['now', '今すぐ'], ['scheduled', '日時を決める']] as const).map(([value, label]) => (
            <button key={value} type="button" role="radio" disabled={busy || pending} aria-checked={when === value} className={styles.chip} onClick={() => setWhen(value)}>
              {label}
            </button>
          ))}
          {when === 'scheduled' ? (
            <div className={styles.whenPick}>
              <SaveErrorField names={["scheduledValue","scheduled_value"]}><DateTimeField disabled={busy || pending} value={scheduledValue} onChange={setScheduledValue} aria-label="送る日時" /></SaveErrorField>
            </div>
          ) : null}
        </div>
<div className={styles.estimateBox}>
          <div className={styles.estimate} aria-live="polite">
            <Users size={16} aria-hidden="true" className={styles.estimateIcon} />
            <span>
              {estimating ? '人数を数えています…' : estimate ? estimateText(estimate) : '本文を書くと、届く人数の見込みが出ます'}
            </span>
          </div>
          {needsCountConfirmation && estimate ? <SingleOperatorFields recipientCount={estimate.count} value={countInput} onChange={setCountInput} /> : null}
          {needsApproval ? (
            <div className={styles.approval}>
              <p className={styles.approvalTitle}>{`${formatNumber(approvalConfig?.threshold ?? APPROVAL_THRESHOLD)} 人以上に送るときは承認が要ります。承認する人を選んで頼んでください。`}</p>
              <SaveErrorField names={["approverId","approverStaffId","approver_id"]}><EntitySelect
                aria-label="承認する人"
                size="full"
                value={approverId}
                onChange={setApproverId}
                options={[{ value: '', label: '承認する人を選ぶ' }, ...candidates.map((item) => ({ ...entityOptionMetadata(item), value: item.id, label: `承認する人：${item.name}${ROLE_LABELS[item.role] ? `（${ROLE_LABELS[item.role]}）` : ''}` }))]}
              /></SaveErrorField>
              <p className={styles.approvalNote}>1人で運用しているときは、人数を確かめるチェックだけで送れます。</p>
            </div>
          ) : null}
        </div></Field></div>
    </Dialog>
    <UnsavedLeaveDialog open={guard.leaveTarget !== null} busy={busy} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} />
    </></SaveErrorScope>
  )
}
