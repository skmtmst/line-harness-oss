'use client'

import { Paperclip, Plus, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  api,
  type OpsSupportDetail,
  type OpsSupportPriority,
  type OpsSupportStage,
  type OpsSupportSummary,
  type OpsSupportTicket,
  type OpsTenantRow,
} from '@/lib/api'
import OpsPageHeader from '@/components/ops/ops-page-header'
import { formatDateTime, planLabel, PLAN_STATUS_LABEL, ROLE_LABEL, tenantDetailHref, opsCall } from '@/components/ops/ops-ui'
import Button from '@/components/shared/button'
import Chip, { type ChipTone } from '@/components/shared/chip'
import ListState from '@/components/shared/list-state'
import SearchField from '@/components/shared/search-field'
import SelectField from '@/components/shared/select-field'
import SummaryCard from '@/components/shared/summary-card'
import { Tabs } from '@/components/shared/tabs'
import { TextArea, TextField } from '@/components/shared/text-field'
import { compareLabel, durationLabel, elapsedLabel } from './format'

/**
 * お問い合わせ（チケット）★V6 37-6 `IjIFa`／37-6-A `b2uv3`（AIの下書き）／37-6-B `XlTAd`（作成中）。
 *
 * 左に一覧、右に内容と返信。返信は統括の登録メールに届き、統括の 36-3 の履歴にも載る。
 * AI の下書きは Cloudflare 内の Workers AI で作り、必ず人が確かめてから送る。
 */

const STAGE_TABS: Array<{ key: OpsSupportStage | 'all'; label: string }> = [
  { key: 'all', label: 'すべて' },
  { key: 'new', label: '新規' },
  { key: 'in_progress', label: '対応中' },
  { key: 'waiting', label: '待ち' },
  { key: 'resolved', label: '解決済み' },
  { key: 'closed', label: 'クローズ' },
]

const STAGE_TONE: Record<OpsSupportStage, ChipTone> = {
  new: 'info', in_progress: 'warn', waiting: 'neutral', resolved: 'ok', closed: 'neutral',
}
const PRIORITY_TONE: Record<OpsSupportPriority, ChipTone> = { high: 'danger', medium: 'warn', low: 'neutral' }

const PRIORITY_OPTIONS = [
  { value: '', label: '優先度' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]
const SORT_OPTIONS = [
  { value: 'newest', label: '並び替え：新しい順' },
  { value: 'oldest', label: '並び替え：古い順' },
  { value: 'priority', label: '並び替え：優先度' },
]
const KIND_OPTIONS = [
  { value: 'usage', label: '使い方について' },
  { value: 'bug', label: '不具合' },
  { value: 'billing', label: '料金・請求' },
  { value: 'feature', label: '要望' },
  { value: 'other', label: 'その他' },
]

function stageChip(stage: OpsSupportStage, label: string) {
  return <Chip tone={STAGE_TONE[stage]}>{label}</Chip>
}
function priorityChip(priority: OpsSupportPriority, label: string) {
  return <Chip tone={PRIORITY_TONE[priority]}>{label}</Chip>
}

export default function OpsSupportPage() {
  const [summary, setSummary] = useState<OpsSupportSummary | null>(null)
  const [tickets, setTickets] = useState<OpsSupportTicket[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [stage, setStage] = useState<OpsSupportStage | 'all'>('new')
  const [priority, setPriority] = useState<'' | OpsSupportPriority>('')
  const [sort, setSort] = useState<'newest' | 'oldest' | 'priority'>('newest')
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<OpsSupportDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [creating, setCreating] = useState(false)
  const [tenants, setTenants] = useState<OpsTenantRow[]>([])
  const [form, setForm] = useState({ tenantId: '', subject: '', body: '', kind: 'other', priority: 'medium' as OpsSupportPriority })
  const [busy, setBusy] = useState(false)

  // 返信欄。下書きの元（人が書いた／AI が作った）を覚えておき、送るときに aiAssisted を付ける。
  const [reply, setReply] = useState('')
  const [replyFromAi, setReplyFromAi] = useState<{ generatedAt: string | null } | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [draftSaving, setDraftSaving] = useState(false)
  const aiAbort = useRef<{ cancelled: boolean } | null>(null)

  const loadSummary = useCallback(async () => {
    const res = await opsCall(api.ops.support.summary())
    if (res.success) setSummary(res.data)
  }, [])

  const loadList = useCallback(async () => {
    setLoading(true)
    const res = await opsCall(api.ops.support.tickets({ stage, priority: priority || undefined, q: q.trim() || undefined, sort, limit: 50 }))
    setLoading(false)
    if (!res.success) { setError(res.error || '読み込めませんでした'); return }
    setTickets(res.data)
    setTotal(res.total)
    setSelectedId((current) => (current && res.data.some((t) => t.id === current) ? current : res.data[0]?.id ?? null))
  }, [stage, priority, q, sort])

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    const res = await opsCall(api.ops.support.ticket(id))
    setDetailLoading(false)
    if (!res.success) { setError(res.error || '内容を読み込めませんでした'); return }
    setDetail(res.data)
    setReply(res.data.draft?.body ?? '')
    setReplyFromAi(res.data.draft?.aiGenerated ? { generatedAt: res.data.draft.generatedAt } : null)
  }, [])

  useEffect(() => { void loadSummary() }, [loadSummary])
  useEffect(() => { void loadList() }, [loadList])
  useEffect(() => {
    if (!selectedId) { setDetail(null); return }
    void loadDetail(selectedId)
  }, [selectedId, loadDetail])

  useEffect(() => {
    if (!creating || tenants.length > 0) return
    void api.ops.tenants().then((res) => { if (res.success) setTenants(res.data.filter((t) => t.status !== 'archived')) })
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
    await refreshAll()
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
    setNotice(res.data ? '下書きを保存しました' : '下書きを消しました')
  }

  const generateAi = async () => {
    if (!detail) return
    const token = { cancelled: false }
    aiAbort.current = token
    setAiBusy(true)
    setError('')
    const res = await opsCall(api.ops.support.aiDraft(detail.ticket.id))
    if (token.cancelled) return
    setAiBusy(false)
    if (!res.success) { setError(res.error || 'AI の下書きを作れませんでした'); return }
    setReply(res.data.body)
    setReplyFromAi({ generatedAt: res.data.generatedAt })
  }

  /** 37-6-B「待たずに手で書く」。作成は続くが、結果は捨てて手書きに戻す。 */
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

  const send = async () => {
    if (!detail || !reply.trim()) return
    setBusy(true)
    setError('')
    const res = await opsCall(api.ops.support.reply(detail.ticket.id, { body: reply, aiAssisted: replyFromAi !== null }))
    setBusy(false)
    if (!res.success) { setError(res.error || '返信できませんでした'); return }
    setReply('')
    setReplyFromAi(null)
    setNotice(res.data.mailSent
      ? `${res.data.ticket.ticketLabel} に返信しました。登録メールにも送りました`
      : res.data.mailSkippedReason === 'no_email'
        ? `${res.data.ticket.ticketLabel} に返信しました。起票者のメールが未登録のため、管理画面の履歴だけに載ります`
        : `${res.data.ticket.ticketLabel} に返信しました。メールは送れなかったので、管理画面の履歴で伝わります`)
    await refreshAll()
  }

  const create = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    const res = await opsCall(api.ops.support.create({ tenantId: form.tenantId, subject: form.subject.trim(), body: form.body.trim(), kind: form.kind, priority: form.priority }))
    setBusy(false)
    if (!res.success) { setError(res.error || '作れませんでした'); return }
    setCreating(false)
    setForm({ tenantId: '', subject: '', body: '', kind: 'other', priority: 'medium' })
    setNotice(`${res.data.ticketLabel} を作りました`)
    setStage('new')
    setSelectedId(res.data.id)
    await refreshAll()
  }

  const listTitle = useMemo(() => {
    const item = STAGE_TABS.find((t) => t.key === stage)
    return stage === 'all' ? 'すべてのチケット' : `${item?.label ?? ''}のチケット`
  }, [stage])

  const kpis = summary?.kpis ?? null
  const ticket = detail?.ticket ?? null
  const closed = ticket?.stage === 'closed'

  return (
    <div data-design-node="IjIFa">
      <OpsPageHeader title="お問い合わせ" />

      <div className="mb-4">
        <Tabs
          items={STAGE_TABS.map((t) => ({
            label: t.label,
            count: summary ? summary.byStage[t.key] : undefined,
            current: stage === t.key,
            onClick: () => setStage(t.key),
          }))}
          actions={
            <span className="flex flex-wrap items-center gap-2">
              <span className="w-64">
                <SearchField value={q} onChange={setQ} onClear={() => setQ('')} placeholder="チケット番号・契約先・件名" aria-label="チケットを探す" />
              </span>
              <SelectField size="compact" aria-label="優先度で絞る" options={PRIORITY_OPTIONS} value={priority} onChange={(e) => setPriority(e.target.value as '' | OpsSupportPriority)} />
              <SelectField aria-label="並び替え" options={SORT_OPTIONS} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} />
              <Button variant="primary" onClick={() => setCreating((v) => !v)}>
                <Plus aria-hidden="true" className="h-4 w-4" />
                チケットを作る
              </Button>
            </span>
          }
        />
      </div>

      {creating ? (
        <form onSubmit={(event) => void create(event)} className="mb-4 grid gap-3 rounded-card border border-hairline bg-canvas px-4 py-4 md:grid-cols-2">
          <label className="grid gap-1 text-caption text-ink-secondary">
            契約先
            <SelectField className="w-full" aria-label="契約先" required value={form.tenantId} onChange={(e) => setForm((f) => ({ ...f, tenantId: e.target.value }))}
              options={[{ value: '', label: '契約先を選ぶ' }, ...tenants.map((t) => ({ value: t.id, label: t.name }))]} />
          </label>
          <label className="grid gap-1 text-caption text-ink-secondary">
            種類・優先度
            <span className="flex gap-2">
              <SelectField className="w-full" aria-label="種類" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))} options={KIND_OPTIONS} />
              <SelectField size="compact" aria-label="優先度" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as OpsSupportPriority }))} options={PRIORITY_OPTIONS.slice(1)} />
            </span>
          </label>
          <label className="grid gap-1 text-caption text-ink-secondary md:col-span-2">
            件名
            <TextField value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="例：電話で受けた配信の相談" maxLength={120} required />
          </label>
          <label className="grid gap-1 text-caption text-ink-secondary md:col-span-2">
            内容
            <TextArea rows={4} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder="相手から聞いた内容をそのまま書きます" maxLength={4000} required />
          </label>
          <div className="flex items-center gap-2 md:col-span-2">
            <Button type="submit" variant="primary" disabled={busy}>作る</Button>
            <Button onClick={() => setCreating(false)}>やめる</Button>
            <span className="text-micro text-ink-faint">電話や LINE で受けた相談を、運営が代わりに起票します。相手にはメールは届きません。</span>
          </div>
        </form>
      ) : null}

      <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard variant="v6" title="未対応のチケット" value={kpis ? kpis.untouched : null} unit="件" detail={kpis ? `LINEから受付 ${kpis.untouchedFromLine}件` : '—'} badge={kpis && kpis.untouched > 0 ? '要対応' : undefined} badgeTone="danger" loading={!summary} />
        <SummaryCard variant="v6" title="平均の初回返信" value={null} unit="" detail={kpis ? compareLabel(kpis.avgFirstReplyMinutes, kpis.prevAvgFirstReplyMinutes, 'time') : '—'} loading={!summary} valueText={kpis ? durationLabel(kpis.avgFirstReplyMinutes) : undefined} />
        <SummaryCard variant="v6" title="解決率" value={null} unit="" detail={kpis ? compareLabel(kpis.resolutionRate, kpis.prevResolutionRate, 'rate') : '—'} loading={!summary} valueText={kpis ? (kpis.resolutionRate === null ? '—' : `${kpis.resolutionRate.toFixed(1)}%`) : undefined} />
        <SummaryCard variant="v6" title="平均の解決時間" value={null} unit="" detail={kpis ? compareLabel(kpis.avgResolutionMinutes, kpis.prevAvgResolutionMinutes, 'time') : '—'} loading={!summary} valueText={kpis ? durationLabel(kpis.avgResolutionMinutes) : undefined} />
      </div>

      {notice ? <p role="status" className="mb-3 text-caption text-accent-deep">{notice}</p> : null}
      {error ? <p role="alert" className="mb-3 text-caption text-status-danger">{error}</p> : null}

      <div className="grid gap-4 xl:grid-cols-3">
        {/* 左：チケット一覧 */}
        <section aria-label={listTitle} className="rounded-card border border-hairline bg-canvas xl:col-span-1">
          <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <h2 className="text-label font-bold text-ink">{listTitle}</h2>
            <span className="text-micro text-ink-faint">{total}件中 {tickets.length === 0 ? 0 : 1}〜{tickets.length}件</span>
          </header>
          {loading && tickets.length === 0 ? (
            <ListState kind="loading" title="チケットを読み込んでいます" />
          ) : tickets.length === 0 ? (
            <ListState kind="empty" title="チケットがありません" description="統括の管理画面「お問い合わせ」から送られると、ここに新規として並びます。" />
          ) : (
            <ul className="divide-y divide-hairline">
              {tickets.map((t) => {
                const selected = t.id === selectedId
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      aria-current={selected ? 'true' : undefined}
                      onClick={() => setSelectedId(t.id)}
                      className={`block w-full px-4 py-3 text-left transition-colors hover:bg-canvas-sunken ${selected ? 'bg-accent-soft' : ''}`}
                    >
                      <span className="flex items-center gap-1.5 text-micro text-ink-secondary">
                        <span className="font-bold text-ink">{t.ticketLabel}</span>
                        <span className="truncate">{t.tenantName}</span>
                        <span className="truncate">{t.staffName || '—'}</span>
                        <span className="ml-auto shrink-0 text-ink-faint">{elapsedLabel(t.lastMessageAt)}</span>
                      </span>
                      <span className="mt-1 block truncate text-label font-bold text-ink">{t.subject}</span>
                      <span className="mt-1.5 flex items-center gap-1.5">
                        {stageChip(t.stage, t.stageLabel)}
                        {priorityChip(t.priority, t.priorityLabel)}
                        <span className="ml-auto text-micro text-ink-faint">{t.channelLabel}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* 右：内容と返信 */}
        <section aria-label="内容と返信" className="rounded-card border border-hairline bg-canvas px-5 py-4 xl:col-span-2">
          {!ticket ? (
            detailLoading ? <ListState kind="loading" title="内容を読み込んでいます" /> : <ListState kind="empty" title="チケットを選んでください" description="左の一覧から開きます。" />
          ) : (
            <div className="grid gap-4">
              {/* 見出し行 */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-label font-bold text-ink-secondary">{ticket.ticketLabel}</span>
                <h2 className="text-body font-bold text-ink">{ticket.subject}</h2>
                {ticket.subjectAuto ? <Chip tone="neutral">自動で付けた件名</Chip> : null}
                {priorityChip(ticket.priority, ticket.priorityLabel)}
                {stageChip(ticket.stage, ticket.stageLabel)}
                <span className="ml-auto flex items-center gap-2">
                  <SelectField size="compact" aria-label="優先度を変える" value={ticket.priority} onChange={(e) => void changePriority(e.target.value as OpsSupportPriority)} options={PRIORITY_OPTIONS.slice(1)} />
                  {ticket.stage === 'resolved' || ticket.stage === 'closed' ? (
                    <Button size="field" disabled={busy} onClick={() => void changeStage('in_progress')}>対応中に戻す</Button>
                  ) : (
                    <Button size="field" disabled={busy} onClick={() => void changeStage('resolved')}>解決済みにする</Button>
                  )}
                  {closed ? null : <Button size="field" disabled={busy} onClick={() => void changeStage('closed')}>クローズする</Button>}
                </span>
              </div>

              {/* 問い合わせ元 */}
              <div className="flex flex-wrap items-start gap-x-8 gap-y-2 rounded-control border border-hairline bg-canvas-sunken px-4 py-3">
                <Meta label="契約先"><Link href={tenantDetailHref(ticket.tenantId)} className="text-accent-deep underline-offset-2 hover:underline">{ticket.tenantName}</Link></Meta>
                <Meta label="起票者">{ticket.staffName || '—'}{ticket.staffRole ? `（${ROLE_LABEL[ticket.staffRole] ?? ticket.staffRole}）` : ''}</Meta>
                <Meta label="受付">{ticket.channel === 'admin' ? '管理画面のお問い合わせ' : ticket.channelLabel}</Meta>
                <Meta label="プラン">{planLabel(ticket.tenantPlanKey)}・{PLAN_STATUS_LABEL[ticket.tenantPlanStatus] ?? ticket.tenantPlanStatus}</Meta>
                <Meta label="店舗">{detail?.tenant.accountCount ?? 0}</Meta>
                <Meta label="LINE登録">{detail ? `${detail.tenant.staffCount}人中${detail.tenant.staffWithLine}人` : '—'}</Meta>
                <Meta label="過去のチケット">{detail ? `${detail.tenant.pastTickets}件（未解決 ${detail.tenant.pastOpen}）` : '—'}</Meta>
                <span className="ml-auto flex items-center gap-2 self-center">
                  <Button size="field" href={tenantDetailHref(ticket.tenantId)}>契約先を開く</Button>
                  <Button size="field" disabled={busy} onClick={() => void impersonate(ticket.tenantId, setBusy, setError)}>代理ログイン</Button>
                </span>
              </div>

              {/* やり取り */}
              <ol className="grid gap-3" aria-label="やり取り">
                <Message side="left" author={`${ticket.tenantName} ／ ${ticket.staffName || '—'}`} at={ticket.createdAt} body={ticket.body} attachments={ticket.attachments} />
                {detail?.messages.map((m) => (
                  <Message
                    key={m.id}
                    side={m.authorKind === 'ops' ? 'right' : 'left'}
                    author={m.authorKind === 'ops' ? `musubo 運営 ／ ${m.authorName}` : `${ticket.tenantName} ／ ${m.authorName}`}
                    at={m.createdAt}
                    body={m.body}
                    attachments={m.attachments}
                  />
                ))}
              </ol>

              {/* 返信 */}
              <div className="grid gap-2 border-t border-hairline pt-4" data-design-node={aiBusy ? 'XlTAd' : replyFromAi ? 'b2uv3' : undefined}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-label font-bold text-ink">返信</h3>
                  {aiBusy ? (
                    <Chip tone="info">作成中…</Chip>
                  ) : replyFromAi ? (
                    <>
                      <Button size="field" onClick={() => void generateAi()} disabled={busy || !detail?.ai.available}>作り直す</Button>
                      <Button size="field" onClick={() => void discardAi()} disabled={busy}>下書きを消す</Button>
                    </>
                  ) : (
                    <Button size="field" onClick={() => void generateAi()} disabled={busy || closed || !detail?.ai.available} title={detail?.ai.available ? undefined : 'この環境では AI の下書きを使えません'}>
                      <Sparkles aria-hidden="true" className="h-4 w-4" />
                      AIで下書きを作る
                    </Button>
                  )}
                </div>
                {aiBusy ? (
                  <div className="flex items-center justify-between rounded-control border border-hairline bg-canvas-sunken px-4 py-3">
                    <p className="text-caption text-ink-secondary" role="status">AIが下書きを作っています。5〜15秒ほどかかります。</p>
                    <Button size="field" onClick={skipAi}>待たずに手で書く</Button>
                  </div>
                ) : replyFromAi ? (
                  <div className="flex items-center justify-between rounded-control border border-hairline bg-accent-soft px-4 py-2">
                    <p className="text-caption text-ink">AIが作った下書きです。内容を確かめて、必要なら直してから送ってください。</p>
                    <span className="text-micro text-ink-faint">{formatDateTime(replyFromAi.generatedAt)} に作成</span>
                  </div>
                ) : null}
                {aiBusy ? null : (
                  <TextArea
                    rows={6}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="返信を入力します。「AIで下書きを作る」を押すと、これまでのやり取りから下書きを作ります。"
                    aria-label="返信"
                    disabled={closed}
                    maxLength={4000}
                  />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-micro text-ink-faint">
                    返信は管理画面のお問い合わせ履歴に載り、登録メールに届きます。
                    {ticket.staffEmailRegistered ? '' : '（起票者のメールが未登録のため、今回は履歴だけに載ります）'}
                  </p>
                  <span className="ml-auto flex items-center gap-2">
                    <Button size="field" onClick={() => void saveDraft()} disabled={busy || draftSaving || closed || aiBusy}>{draftSaving ? '保存中…' : '下書き保存'}</Button>
                    <Button size="field" variant="primary" onClick={() => void send()} disabled={busy || closed || aiBusy || !reply.trim()}>返信する</Button>
                  </span>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
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

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="grid gap-0.5">
      <span className="text-micro text-ink-faint">{label}</span>
      <span className="text-caption text-ink">{children}</span>
    </span>
  )
}

function Message({ side, author, at, body, attachments }: { side: 'left' | 'right'; author: string; at: string; body: string; attachments: Array<{ key: string; url: string; name: string }> }) {
  return (
    <li className={`grid max-w-3xl gap-1 ${side === 'right' ? 'justify-self-end text-right' : ''}`}>
      <span className="flex items-baseline gap-2 text-micro text-ink-secondary">
        <span className="font-bold">{author}</span>
        <span className="text-ink-faint">{formatDateTime(at)}</span>
      </span>
      <p className={`whitespace-pre-wrap rounded-control px-4 py-3 text-left text-caption text-ink ${side === 'right' ? 'bg-accent-soft' : 'bg-canvas-sunken'}`}>{body}</p>
      {attachments.length > 0 ? (
        <span className="flex flex-wrap gap-2">
          {attachments.map((a) => (
            <a key={a.key} href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-micro text-accent-deep underline-offset-2 hover:underline">
              <Paperclip aria-hidden="true" className="h-3.5 w-3.5" />
              {a.name}（{side === 'right' ? '運営から' : '契約先から'}）
            </a>
          ))}
        </span>
      ) : null}
    </li>
  )
}
