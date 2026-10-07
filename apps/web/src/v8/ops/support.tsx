'use client'

import { Building2, Check, CircleDot, LogIn, Paperclip, Plus, RefreshCw, Send, Sparkles, Star } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api,
  type OpsKnowledgeReference,
  type OpsSupportDetail,
  type OpsSupportPriority,
  type OpsSupportStage,
  type OpsSupportSummary,
  type OpsSupportTicket,
  type OpsTenantRow,
} from '@/lib/api'
import { KnowledgeReferences, TicketKnowledge } from '@/components/ops/knowledge-ticket'
import { formatDateTime, planLabel, tenantDetailHref, opsCall } from '@/components/ops/ops-ui'
import { opsEnvironmentLabel } from '@/components/ops/ops-env-bar'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { TextArea, TextField } from '@/components/shared/text-field'
import { OpsHead } from './shell'
import { useOpsReadOnly } from './use-ops-read-only'
import parts from './parts.module.css'
import styles from './support.module.css'

/**
 * 運営のお問い合わせ V8（絵 `P0jhqO`・代わりに起票 `Izau1`）。
 *
 * 動きは v7（app/ops/support）と同じ口：一覧（段階・優先度・並び・検索）、内容と返信、
 * AI の下書き（作る・作り直す・消す・待たずに手で書く）、下書きの保存、返信の前の確認（GgP2d）、
 * 解決済み・クローズ・対応中に戻す、代わりに起票、`?id=` で1件を開く。
 * 閲覧のみの運営メンバーには、起票・返信・段階の変更を出さない（読むだけ）。
 */

const STAGE_CHIPS: Array<{ key: OpsSupportStage | 'all'; label: string }> = [
  { key: 'all', label: 'すべて' },
  { key: 'new', label: '新規' },
  { key: 'in_progress', label: '対応中' },
  { key: 'waiting', label: '確認待ち' },
  { key: 'resolved', label: '解決' },
  { key: 'closed', label: 'クローズ' },
]

const STAGE_TONE: Record<OpsSupportStage, StatusBadgeTone> = {
  new: 'danger', in_progress: 'info', waiting: 'warning', resolved: 'success', closed: 'neutral',
}

function stageLabel(stage: OpsSupportStage, fallback: string): string {
  if (stage === 'waiting') return '確認待ち'
  if (stage === 'resolved') return '解決'
  return fallback
}

const PRIORITY_FILTER = [
  { value: '', label: '優先度：すべて' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]
const SORT_OPTIONS = [
  { value: 'priority', label: '並び替え：優先度' },
  { value: 'newest', label: '並び替え：新しい順' },
  { value: 'oldest', label: '並び替え：古い順' },
]
const PRIORITY_OPTIONS = PRIORITY_FILTER.slice(1)
const KIND_OPTIONS = [
  { value: 'usage', label: '使い方について' },
  { value: 'bug', label: '不具合' },
  { value: 'billing', label: '料金・請求' },
  { value: 'feature', label: '要望' },
  { value: 'other', label: 'その他' },
]

/** 「9/30 11:00」の形。 */
function shortDateTime(value: string | null): string {
  if (!value) return '—'
  const full = formatDateTime(value)
  const m = full.match(/^(\d+)-(\d+)-(\d+) (\d+:\d+)$/)
  return m ? `${Number(m[2])}/${Number(m[3])} ${m[4]}` : full
}

export default function OpsSupportV8() {
  const readOnly = useOpsReadOnly()
  const [summary, setSummary] = useState<OpsSupportSummary | null>(null)
  const [tickets, setTickets] = useState<OpsSupportTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [stage, setStage] = useState<OpsSupportStage | 'all'>('all')
  const [priority, setPriority] = useState<'' | OpsSupportPriority>('')
  const [sort, setSort] = useState<'newest' | 'oldest' | 'priority'>('priority')
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<OpsSupportDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [creating, setCreating] = useState(false)
  const [tenants, setTenants] = useState<OpsTenantRow[]>([])
  const [form, setForm] = useState({ tenantId: '', subject: '', body: '', kind: 'usage', priority: 'medium' as OpsSupportPriority })
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState('')
  const [replyFromAi, setReplyFromAi] = useState<{ generatedAt: string | null } | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [draftSaving, setDraftSaving] = useState(false)
  const aiAbort = useRef<{ cancelled: boolean } | null>(null)
  const detailRequest = useRef(0)
  const listRequest = useRef(0)
  const deepLink = useRef<string | null>(null)
  const [references, setReferences] = useState<OpsKnowledgeReference[]>([])
  const [excluded, setExcluded] = useState<string[]>([])
  const [listFailed, setListFailed] = useState(false)
  const [detailFailed, setDetailFailed] = useState(false)
  const [confirmReply, setConfirmReply] = useState(false)
  const [createError, setCreateError] = useState('')

  useEffect(() => {
    deepLink.current = new URLSearchParams(window.location.search).get('id')
    if (deepLink.current) setSelectedId(deepLink.current)
    return () => { detailRequest.current += 1; listRequest.current += 1; if (aiAbort.current) aiAbort.current.cancelled = true }
  }, [])

  const loadSummary = useCallback(async () => {
    const res = await opsCall(api.ops.support.summary())
    if (res.success) setSummary(res.data)
  }, [])

  const loadList = useCallback(async () => {
    const sequence = ++listRequest.current
    setLoading(true)
    setListFailed(false)
    const res = await opsCall(api.ops.support.tickets({ stage, priority: priority || undefined, q: q.trim() || undefined, sort, limit: 50 }))
    if (sequence !== listRequest.current) return
    setLoading(false)
    if (!res.success) { setError(res.error || '読み込めませんでした'); setListFailed(true); return }
    setTickets(res.data)
    setSelectedId((current) => deepLink.current || (current && res.data.some((t) => t.id === current) ? current : res.data[0]?.id ?? null))
  }, [stage, priority, q, sort])

  const loadDetail = useCallback(async (id: string) => {
    const sequence = ++detailRequest.current
    setDetailLoading(true)
    setDetailFailed(false)
    const res = await opsCall(api.ops.support.ticket(id))
    if (sequence !== detailRequest.current) return
    setDetailLoading(false)
    if (!res.success) { setError(res.error || '内容を読み込めませんでした'); setDetailFailed(true); return }
    setDetail(res.data)
    setReply(res.data.draft?.body ?? '')
    setReplyFromAi(res.data.draft?.aiGenerated ? { generatedAt: res.data.draft.generatedAt } : null)
    setReferences(res.data.draft?.references ?? [])
  }, [])

  useEffect(() => { void loadSummary() }, [loadSummary])
  useEffect(() => { void loadList() }, [loadList])
  useEffect(() => {
    if (aiAbort.current) aiAbort.current.cancelled = true
    setAiBusy(false); setExcluded([]); setReferences([]); setReply(''); setReplyFromAi(null)
    detailRequest.current += 1
    setDetail(null)
    if (!selectedId) return
    void loadDetail(selectedId)
  }, [selectedId, loadDetail])

  // ナレッジの確認（Cron が止まっていても進むよう、画面から順に進める）。返信の下書きは触らない。
  const knowledgePending = detail?.knowledge?.job?.source_current === 1 && ['queued', 'running'].includes(detail.knowledge.job.status)
  const knowledgeRequestId = detail?.ticket.id
  const knowledgeJobId = detail?.knowledge?.job?.id
  const canProcessKnowledge = detail?.knowledge?.canProcess === true
  useEffect(() => {
    if (!knowledgeRequestId || !knowledgePending) return
    let active = true
    const id = knowledgeRequestId
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      const res = canProcessKnowledge
        ? await opsCall(api.ops.knowledge.process(id))
        : await opsCall(api.ops.support.ticket(id).then((r) => (r.success ? { ...r, data: r.data.knowledge } : r)))
      if (!active) return
      if (!res.success) { setError(res.error || 'ナレッジの確認を再開できませんでした'); return }
      const knowledge = res.data
      setDetail((current) => (current?.ticket.id === id ? { ...current, knowledge } : current))
      if (knowledge?.job?.source_current === 1 && ['queued', 'running'].includes(knowledge.job.status)) {
        timer = setTimeout(() => { void tick() }, 15_000)
      }
    }
    if (canProcessKnowledge) void tick()
    else timer = setTimeout(() => { void tick() }, 15_000)
    return () => { active = false; clearTimeout(timer) }
  }, [knowledgeRequestId, knowledgeJobId, canProcessKnowledge, knowledgePending])

  useEffect(() => {
    if (!creating || tenants.length > 0) return
    void opsCall(api.ops.tenants()).then((res) => { if (res.success) setTenants(res.data.filter((t) => t.status !== 'archived')) })
  }, [creating, tenants.length])

  const refreshAll = useCallback(async () => {
    await Promise.all([loadSummary(), loadList()])
    if (selectedId) await loadDetail(selectedId)
  }, [loadSummary, loadList, loadDetail, selectedId])

  const changeStage = async (next: OpsSupportStage) => {
    if (!detail) return
    setBusy(true)
    setError('')
    const res = await opsCall(api.ops.support.update(detail.ticket.id, { stage: next }))
    setBusy(false)
    if (!res.success) { setError(res.error || '変更できませんでした'); return }
    setNotice(`${res.data.ticketLabel} を「${res.data.stageLabel}」にしました`)
    deepLink.current = res.data.id
    setStage(next)
    await Promise.all([loadSummary(), loadDetail(res.data.id)])
  }

  const changePriority = async (next: OpsSupportPriority) => {
    if (!detail) return
    const res = await opsCall(api.ops.support.update(detail.ticket.id, { priority: next }))
    if (!res.success) { setError(res.error || '変更できませんでした'); return }
    await refreshAll()
  }

  const saveDraft = async () => {
    if (!detail) return
    setDraftSaving(true)
    setError('')
    const res = await opsCall(api.ops.support.saveDraft(detail.ticket.id, reply))
    setDraftSaving(false)
    if (!res.success) { setError(res.error || '下書きを保存できませんでした'); return }
    setReplyFromAi(null)
    setReferences([])
    setNotice(res.data ? '下書きを保存しました' : '下書きを消しました')
  }

  const generateAi = async (excludeIds = excluded) => {
    if (!detail) return
    const token = { cancelled: false }
    aiAbort.current = token
    setAiBusy(true)
    setError('')
    const res = await opsCall(api.ops.support.aiDraft(detail.ticket.id, excludeIds))
    if (token.cancelled) return
    setAiBusy(false)
    if (!res.success) { setError(res.error || 'AI の下書きを作れませんでした'); return }
    setReply(res.data.body)
    setReplyFromAi({ generatedAt: res.data.generatedAt })
    setReferences(res.data.references ?? [])
  }

  const skipAi = () => {
    if (aiAbort.current) aiAbort.current.cancelled = true
    setAiBusy(false)
  }

  const discardAi = async () => {
    if (!detail) return
    const res = await opsCall(api.ops.support.deleteDraft(detail.ticket.id))
    if (!res.success) { setError(res.error || '下書きを消せませんでした'); return }
    setReply('')
    setReplyFromAi(null)
  }

  const clearDraftFromConfirm = async () => {
    if (!detail || busy) return
    if (replyFromAi) {
      setBusy(true)
      const res = await opsCall(api.ops.support.deleteDraft(detail.ticket.id))
      setBusy(false)
      if (!res.success) { setError(res.error || '下書きを消せませんでした'); return }
      setReplyFromAi(null)
    }
    setReply('')
    setConfirmReply(false)
  }

  const send = async () => {
    if (!detail || !reply.trim()) return
    setBusy(true)
    setError('')
    const res = await opsCall(api.ops.support.reply(detail.ticket.id, { body: reply, aiAssisted: replyFromAi !== null }))
    setBusy(false)
    if (!res.success) { setError(res.error || '返信できませんでした'); return }
    setReply('')
    setReplyFromAi(null)
    setConfirmReply(false)
    setNotice(res.data.mailSent
      ? `${res.data.ticket.ticketLabel} に返信しました。登録メールにも送りました`
      : res.data.mailSkippedReason === 'no_email'
        ? `${res.data.ticket.ticketLabel} に返信しました。起票者のメールが未登録のため、管理画面の履歴だけに載ります`
        : `${res.data.ticket.ticketLabel} に返信しました。メールは送れなかったので、管理画面の履歴で伝わります`)
    await refreshAll()
  }

  const create = async () => {
    if (busy) return
    if (!form.tenantId) { setCreateError('契約先を選んでください'); return }
    if (!form.subject.trim() || !form.body.trim()) { setCreateError('件名と内容を入れてください'); return }
    setBusy(true)
    setCreateError('')
    const res = await opsCall(api.ops.support.create({ tenantId: form.tenantId, subject: form.subject.trim(), body: form.body.trim(), kind: form.kind, priority: form.priority }))
    setBusy(false)
    if (!res.success) { setCreateError(res.error || '作れませんでした'); return }
    setCreating(false)
    setForm({ tenantId: '', subject: '', body: '', kind: 'usage', priority: 'medium' })
    setNotice(`${res.data.ticketLabel} を作りました`)
    setStage('new')
    setSelectedId(res.data.id)
    await refreshAll()
  }

  const ticket = detail?.ticket ?? null
  const closed = ticket?.stage === 'closed'
  const pick = (id: string) => { deepLink.current = null; if (aiAbort.current) aiAbort.current.cancelled = true; setSelectedId(id) }
  const chip = (c: { key: OpsSupportStage | 'all'; label: string }) => (
    <FilterChip
      key={c.key}
      icon={c.key === 'all' ? <CircleDot size={13} aria-hidden="true" /> : <Star size={13} aria-hidden="true" />}
      selected={stage === c.key}
      onChange={() => setStage(c.key)}
    >
      {summary ? `${c.label} ${summary.byStage[c.key]}` : c.label}
    </FilterChip>
  )

  return (
    <div data-design-node="P0jhqO">
      <OpsHead
        title="お問い合わせ"
        description="統括の管理画面「お問い合わせ」から送られたものが新規として並びます。電話や LINE で受けた相談は、運営が代わりに起票できます"
        environment={opsEnvironmentLabel(process.env.NEXT_PUBLIC_API_URL)}
        actions={readOnly ? null : (
          <Button onClick={() => { setCreateError(''); setCreating(true) }}><Plus aria-hidden="true" />代わりに起票する</Button>
        )}
      />
      {notice ? <p role="status" className={`${parts.status} ${styles.notice}`}>{notice}</p> : null}
      {error && !listFailed && !detailFailed ? <p role="alert" className={`${parts.alert} ${styles.notice}`}>{error}</p> : null}

      <div className={styles.columns}>
        <section aria-label="チケットの一覧" className={styles.list}>
          <SearchField value={q} onChange={setQ} onClear={() => setQ('')} placeholder="チケットを探す" aria-label="チケットを探す" />
          <div className={styles.chipRow}>{STAGE_CHIPS.slice(0, 3).map(chip)}</div>
          <div className={styles.chipColumn}>
            {STAGE_CHIPS.slice(3).map(chip)}
            <div className={styles.priority}>
              <Select aria-label="優先度で絞る" options={PRIORITY_FILTER} value={priority} onChange={(value) => setPriority(value as '' | OpsSupportPriority)} />
            </div>
          </div>
          <div className={styles.sort}>
            <Select aria-label="並び替え" options={SORT_OPTIONS} value={sort} onChange={(value) => setSort(value as typeof sort)} size="full" />
          </div>
          {loading && tickets.length === 0 ? (
            <ListState kind="loading" title="チケットを読み込んでいます" />
          ) : listFailed && tickets.length === 0 ? (
            <ListState kind="error" title="チケットを読み込めませんでした" description="通信が切れたか、サーバが応えませんでした。" onRetry={() => void loadList()} />
          ) : tickets.length === 0 ? (
            <ListState kind="empty" title="チケットがありません" description="統括の管理画面「お問い合わせ」から送られると、ここに新規として並びます。" />
          ) : (
            <ul className={styles.tickets}>
              {tickets.map((t) => (
                <li key={t.id}>
                  <button type="button" aria-current={t.id === selectedId ? 'true' : undefined} onClick={() => pick(t.id)} className={`${styles.ticket} ${t.id === selectedId ? styles.ticketSelected : ''}`}>
                    <span className={styles.ticketTop}>
                      <span className={styles.ticketNo}>{t.ticketLabel}</span>
                      <StatusBadge tone={STAGE_TONE[t.stage]}>{stageLabel(t.stage, t.stageLabel)}</StatusBadge>
                    </span>
                    <span className={styles.ticketSubject}>{t.subject}</span>
                    <span className={styles.ticketMeta}>{`${t.tenantName}・優先度 ${t.priorityLabel}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="内容と返信" className={styles.detail}>
          {!ticket ? (
            detailLoading ? <ListState kind="loading" title="内容を読み込んでいます" /> : detailFailed ? (
              <ListState kind="error" title="内容を読み込めませんでした" description="通信が切れたか、サーバが応えませんでした。" onRetry={selectedId ? () => void loadDetail(selectedId) : undefined} />
            ) : <ListState kind="empty" title="チケットを選んでください" description="左の一覧から開きます。" />
          ) : (
            <>
              <div className={styles.detailHead}>
                <h2 className={styles.detailTitle}>{`${ticket.ticketLabel} ${ticket.subject}`}</h2>
                {readOnly ? null : (
                  <span className={styles.prioritySelect}>
                    <Select size="page-size" aria-label="優先度を変える" value={ticket.priority} onChange={(value) => void changePriority(value as OpsSupportPriority)} options={PRIORITY_OPTIONS} />
                  </span>
                )}
                <Button href={tenantDetailHref(ticket.tenantId)}><Building2 aria-hidden="true" />契約先を開く</Button>
                {readOnly ? null : <Button disabled={busy} onClick={() => void impersonate(ticket.tenantId, setBusy, setError)}><LogIn aria-hidden="true" />代理ログイン</Button>}
              </div>
              <div className={styles.detailMeta}>
                <StatusBadge tone={STAGE_TONE[ticket.stage]}>{stageLabel(ticket.stage, ticket.stageLabel)}</StatusBadge>
                <span>{`${ticket.tenantName}・${planLabel(ticket.tenantPlanKey)}・LINE登録${detail && detail.tenant.staffWithLine > 0 ? 'あり' : 'なし'}・${ticket.kindLabel}・優先度 ${ticket.priorityLabel}`}</span>
                {ticket.subjectAuto ? <StatusBadge tone="neutral">自動で付けた件名</StatusBadge> : null}
              </div>
              {detail ? <TicketKnowledge key={ticket.id} detail={detail} onRefresh={() => void loadDetail(ticket.id)} /> : null}
              <ol className={styles.messages} aria-label="やり取り">
                <Message mine={false} author={`${ticket.staffName || ticket.tenantName}（${shortDateTime(ticket.createdAt)}）`} body={ticket.body} attachments={ticket.attachments} />
                {detail?.messages.map((m) => (
                  <Message
                    key={m.id}
                    mine={m.authorKind === 'ops'}
                    author={`${m.authorKind === 'ops' ? `運営 ${m.authorName}` : m.authorName}（${shortDateTime(m.createdAt)}）`}
                    body={m.body}
                    attachments={m.attachments}
                  />
                ))}
              </ol>

              {readOnly ? null : (
                <>
                  <div className={styles.draft}>
                    <div className={styles.draftHead}>
                      <Sparkles aria-hidden="true" />
                      <span className={styles.draftTitle}>{aiBusy ? 'AI の下書きを作成中…' : replyFromAi ? 'AI の下書き' : '返信'}</span>
                      <span className={styles.spacer} />
                      {aiBusy ? (
                        <Button onClick={skipAi}>待たずに手で書く</Button>
                      ) : replyFromAi ? (
                        <>
                          <Button onClick={() => void discardAi()} disabled={busy}>下書きを削除する</Button>
                          <Button onClick={() => void generateAi()} disabled={busy || !detail?.ai.available}><RefreshCw aria-hidden="true" />作り直す</Button>
                        </>
                      ) : (
                        <Button onClick={() => void generateAi()} disabled={busy || closed || !detail?.ai.available} title={detail?.ai.available ? undefined : 'この環境では AI の下書きを使えません'}>
                          <Sparkles aria-hidden="true" />AIで下書きを作る
                        </Button>
                      )}
                    </div>
                    {aiBusy ? (
                      <p className={styles.draftNote} role="status">AIが下書きを作っています。5〜15秒ほどかかります。</p>
                    ) : (
                      <>
                        <KnowledgeReferences key={ticket.id} references={replyFromAi ? references : []} requestId={ticket.id} busy={busy} onExclude={(id) => {
                          const next = [...new Set([...excluded, id])]; setExcluded(next); void generateAi(next)
                        }} />
                        <TextArea
                          className={styles.replyBox}
                          rows={2}
                          value={reply}
                          onChange={(e) => setReply(e.target.value)}
                          placeholder="返信を入力します。「AIで下書きを作る」を押すと、これまでのやり取りから下書きを作ります。"
                          aria-label="返信"
                          disabled={closed}
                          maxLength={4000}
                        />
                        <p className={styles.draftNote}>
                          {replyFromAi
                            ? 'お客様の状況・やり取りとナレッジをもとに作った下書きです。内容を確認してから送ってください。'
                            : `返信は管理画面のお問い合わせ履歴に載り、登録メールに届きます。${ticket.staffEmailRegistered ? '' : '（起票者のメールが未登録のため、今回は履歴だけに載ります）'}`}
                        </p>
                      </>
                    )}
                  </div>
                  <div className={styles.actions}>
                    {ticket.stage === 'resolved' || ticket.stage === 'closed'
                      ? <Button disabled={busy} onClick={() => void changeStage('in_progress')}>対応中に戻す</Button>
                      : <Button disabled={busy} onClick={() => void changeStage('resolved')}><Check aria-hidden="true" />解決済みにする</Button>}
                    {closed ? null : <Button disabled={busy} onClick={() => void changeStage('closed')}>クローズする</Button>}
                    <span className={styles.spacer} />
                    <Button onClick={() => void saveDraft()} disabled={busy || draftSaving || closed || aiBusy} busy={draftSaving}>下書きを保存する</Button>
                    <Button variant="primary" onClick={() => { setError(''); setConfirmReply(true) }} disabled={busy || closed || aiBusy || !reply.trim()}><Send aria-hidden="true" />返信する</Button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>

      <Dialog
        open={creating}
        designWidth={560}
        designTop={160}
        title="チケットを作る"
        confirmLabel="作る"
        cancelLabel="キャンセル"
        confirmIcon={<Plus size={15} aria-hidden="true" />}
        busy={busy}
        error={createError || undefined}
        designNode="Izau1"
        onConfirm={() => void create()}
        onCancel={() => { if (!busy) setCreating(false) }}
      >
        <div className={parts.dialogBody}>
          <div className={styles.field}>
            <span className={styles.smallLabel}>契約先</span>
            <div className={styles.fullSelect}>
              <Select size="full" aria-label="契約先" value={form.tenantId} onChange={(value) => setForm((f) => ({ ...f, tenantId: value }))} options={[{ value: '', label: '契約先を選ぶ' }, ...tenants.map((t) => ({ value: t.id, label: t.name }))]} />
            </div>
          </div>
          <div className={styles.pair}>
            <div className={styles.field}>
              <span className={styles.smallLabel}>種類</span>
              <div className={styles.fullSelect}>
                <Select size="full" aria-label="種類" value={form.kind} onChange={(value) => setForm((f) => ({ ...f, kind: value }))} options={KIND_OPTIONS} />
              </div>
            </div>
            <div className={styles.field}>
              <span className={styles.smallLabel}>優先度</span>
              <div className={styles.fullSelect}>
                <Select size="full" aria-label="優先度" value={form.priority} onChange={(value) => setForm((f) => ({ ...f, priority: value as OpsSupportPriority }))} options={PRIORITY_OPTIONS} />
              </div>
            </div>
          </div>
          <label className={styles.field}>
            <span className={styles.label}>件名</span>
            <TextField value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="例：電話で受けた配信の相談" maxLength={120} aria-label="件名" />
          </label>
          <label className={styles.field}>
            <span className={styles.smallLabel}>内容</span>
            <TextArea className={styles.createBody} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder="相手から聞いた内容をそのまま書きます" maxLength={4000} aria-label="内容" />
          </label>
          <p className={parts.dialogNote}>電話や LINE で受けた相談を、運営が代わりに起票します。相手にはメールは届きません。</p>
        </div>
      </Dialog>

      {ticket ? (
        <Dialog
          open={confirmReply}
          title="この返事を送りますか？"
          busy={busy}
          error={error || undefined}
          designNode="GgP2d"
          onCancel={() => { if (!busy) setConfirmReply(false) }}
          footer={(
            <div className={styles.confirmActions}>
              <Button variant="danger" onClick={() => void clearDraftFromConfirm()} disabled={busy}>下書きを削除</Button>
              <span className={styles.spacer} />
              <Button onClick={() => { if (!busy) setConfirmReply(false) }} disabled={busy}>戻って直す</Button>
              <Button variant="primary" onClick={() => void send()} disabled={busy} busy={busy} busyLabel="送信中…">送って解決にする</Button>
            </div>
          )}
        >
          <div className={parts.dialogBody}>
            <dl className={styles.facts}>
              <div className={styles.fact}><dt>宛先</dt><dd>{`${ticket.tenantName}（担当：${ticket.staffName || '—'}）・${ticket.channelLabel}`}</dd></div>
              <div className={styles.fact}><dt>状態</dt><dd>{`${ticket.stageLabel} → 解決（送ったあと）`}</dd></div>
              <div className={styles.fact}><dt>優先度</dt><dd>{ticket.priorityLabel}</dd></div>
            </dl>
            {replyFromAi && references.length > 0 ? (
              <p className={parts.dialogNote}>{`AI の下書きの根拠：${references.map((ref) => `ナレッジ「${ref.title}」`).join('・')}をもとに作成`}</p>
            ) : null}
            <p className={styles.confirmBody}>{reply}</p>
          </div>
        </Dialog>
      ) : null}
    </div>
  )
}

async function impersonate(tenantId: string, setBusy: (v: boolean) => void, setError: (v: string) => void) {
  setBusy(true)
  const res = await opsCall(api.ops.impersonation.start(tenantId))
  setBusy(false)
  if (!res.success) { setError(res.error || '代理ログインを始められませんでした'); return }
  window.location.assign('/hq')
}

function Message({ mine, author, body, attachments }: { mine: boolean; author: string; body: string; attachments: Array<{ key: string; url: string; name: string }> }) {
  return (
    <li className={`${styles.message} ${mine ? styles.messageMine : ''}`}>
      <span className={styles.messageAuthor}>{author}</span>
      <p className={styles.messageBody}>{body}</p>
      {attachments.length > 0 ? (
        <span className={styles.attachments}>
          {attachments.map((a) => (
            <a key={a.key} href={a.url} target="_blank" rel="noreferrer" className={parts.textLink}>
              <Paperclip aria-hidden="true" />{`${a.name}（${mine ? '運営から' : '契約先から'}）`}
            </a>
          ))}
        </span>
      ) : null}
    </li>
  )
}
