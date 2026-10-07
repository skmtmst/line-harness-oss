'use client'

/*
 * ★V8 一斉配信 かんたんに送る（板 `P6vbxn`・小窓 640）。
 *
 * 今の部品（app/broadcasts/quick-send-dialog.tsx。一覧から開く口が無かった）の動きを写して一から書いた。
 * 本文・相手・いつ・人数の見込み・承認の順。1,000人以上に送るときは承認する人を選んで頼む。
 * 口は今と同じ（tags.list・approval.candidates・preflight・create・send・approval.request）。
 * 入口：一斉配信一覧の「配信を作る ▾」の「かんたんに送る」（絵 `Xr6eu` の分け方）。
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ListOrdered, Send, Users } from 'lucide-react'
import type { Tag } from '@line-crm/shared'
import { api, type BroadcastApprovalCandidate } from '@/lib/api'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import Select from '@/components/shared/select'
import DateTimeField from '@/components/shared/date-time-field'
import { formatNumber } from '@/lib/format'
import styles from './quick-send.module.css'

/** 承認を頼む境目（絵の文どおり）。 */
export const APPROVAL_THRESHOLD = 1000
export const TEXT_LIMIT = 5000
const ROLE_LABELS: Record<string, string> = { owner: 'オーナー', admin: '管理者', staff: 'スタッフ' }

type Estimate = { count: number; blocked: number; remaining: number | null }

/** 見込みの1文。今月の残りが読めたときだけ足す。 */
export function estimateText(estimate: Estimate): string {
  const base = `${formatNumber(estimate.count)}人に届く見込み（ブロック中 ${formatNumber(estimate.blocked)}人を除く）`
  return estimate.remaining === null ? base : `${base}・今月あと ${formatNumber(estimate.remaining)}通 送れます`
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const estimateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textRef = useRef<HTMLTextAreaElement | null>(null)

  // 開いたら入力を空に戻し、タグと承認する人の候補を読む。
  useEffect(() => {
    if (!open) return
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
            setEstimate({ count: res.data.audienceCount, blocked: res.data.hiddenExcluded, remaining: res.data.quota?.remaining ?? null })
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
  const scheduledAt = when === 'scheduled' && scheduledValue ? `${scheduledValue}:00` : null
  const canSend = text.trim().length > 0
    && text.length <= TEXT_LIMIT
    && (target === 'all' || tagId !== '')
    && (when === 'now' || scheduledValue !== '')
    && (!needsApproval || approverId !== '')
    && !busy

  /** 差し込む：今のカーソルの位置に {名前} を入れる。 */
  const insertName = () => {
    const el = textRef.current
    const token = '{名前}'
    if (!el) return setText((prev) => `${prev}${token}`)
    const start = el.selectionStart ?? text.length
    const end = el.selectionEnd ?? text.length
    setText(`${text.slice(0, start)}${token}${text.slice(end)}`)
  }

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
      if (!created.success) throw new Error(created.error ?? '作れませんでした')
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

  const sendLabel = needsApproval ? '承認を頼む' : scheduledAt ? '予約する' : '送る'

  return (
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
      <div className={styles.body}>
        <label className={styles.label} htmlFor="quick-send-v8-text">本文</label>
        <textarea
          id="quick-send-v8-text"
          ref={textRef}
          className={styles.textarea}
          value={text}
          maxLength={TEXT_LIMIT}
          onChange={(event) => setText(event.target.value)}
        />
        <div className={styles.metaRow}>
          <span className={styles.meta}>差し込む：</span>
          <button type="button" className={styles.insert} onClick={insertName}>名前</button>
          <span className={styles.spacer} aria-hidden="true" />
          <span className={styles.meta}>{`${formatNumber(text.length)} / ${formatNumber(TEXT_LIMIT)}`}</span>
        </div>

        <p className={styles.label} id="quick-send-v8-target">送る相手</p>
        <div className={styles.chips} role="radiogroup" aria-labelledby="quick-send-v8-target">
          {([['all', '友だち全員'], ['tag', 'タグで絞る']] as const).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={target === value} className={styles.chip} onClick={() => setTarget(value)}>
              {label}
            </button>
          ))}
          {target === 'tag' ? (
            <div className={styles.tagPick}>
              <Select
                aria-label="タグ"
                value={tagId}
                onChange={setTagId}
                options={[{ value: '', label: 'タグを選ぶ' }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))]}
              />
            </div>
          ) : null}
        </div>

        <p className={styles.label} id="quick-send-v8-when">いつ</p>
        <div className={styles.chips} role="radiogroup" aria-labelledby="quick-send-v8-when">
          {([['now', '今すぐ'], ['scheduled', '日時を決める']] as const).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={when === value} className={styles.chip} onClick={() => setWhen(value)}>
              {label}
            </button>
          ))}
          {when === 'scheduled' ? (
            <div className={styles.whenPick}>
              <DateTimeField value={scheduledValue} onChange={setScheduledValue} aria-label="送る日時" />
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
          {needsApproval ? (
            <div className={styles.approval}>
              <p className={styles.approvalTitle}>{`${formatNumber(APPROVAL_THRESHOLD)}人以上に送るときは承認が要ります。承認する人を選んで頼んでください。`}</p>
              <Select
                aria-label="承認する人"
                size="full"
                value={approverId}
                onChange={setApproverId}
                options={[{ value: '', label: '承認する人を選ぶ' }, ...candidates.map((item) => ({ value: item.id, label: `承認する人：${item.name}${ROLE_LABELS[item.role] ? `（${ROLE_LABELS[item.role]}）` : ''}` }))]}
              />
              <p className={styles.approvalNote}>1人で運用しているときは、人数を確かめるチェックだけで送れます。</p>
            </div>
          ) : null}
        </div>
      </div>
    </Dialog>
  )
}
