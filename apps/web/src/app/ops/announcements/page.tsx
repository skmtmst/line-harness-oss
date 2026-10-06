'use client'

import { Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ApiError,
  api,
  type OpsAnnouncement,
  type OpsAnnouncementAudience,
  type OpsAnnouncementChannel,
  type OpsAnnouncementInput,
  type OpsAudiencePreview,
  type OpsTenantRow,
} from '@/lib/api'
import PageHeader from '@/components/shared/page-header'
import Checkbox from '@/components/shared/checkbox'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import HelpTip from '@/components/shared/help-tip'
import './announcements-v8.css'
import '@/app/ops/readonly-v8.css'
import { formatDateTime, opsCall, opsErrorMessage } from '@/components/ops/ops-ui'
import { previewLabel, toLocalInput, toPublishAt } from './format'
import Button from '@/components/shared/button'
import Chip, { type ChipTone } from '@/components/shared/chip'
import { isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextArea, TextField } from '@/components/shared/text-field'
import DateTimeField from '@/components/shared/date-time-field'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'

/**
 * お知らせ配信 ★V6 37-7 `q2CokV`。
 *
 * 左でお知らせを作り（宛先・件名・本文・送り方・公開日時）、右に配信済み・予約・下書きの表。
 * 送り方は 契約者専用LINE／画面のお知らせ／メール。LINE の Messaging API には既読の通知が無いので、
 * 表には「LINE送達」（push が受け付けられた数）と「画面で既読」を出す。
 */

const AUDIENCES: Array<{ key: OpsAnnouncementAudience; label: string }> = [
  { key: 'all', label: 'すべての契約先' },
  { key: 'plan', label: 'プラン別' },
  { key: 'tenants', label: '契約先を選ぶ' },
]
const PLANS: Array<{ key: string; label: string }> = [
  { key: 'light', label: 'ライト' }, { key: 'standard', label: 'スタンダード' }, { key: 'pro', label: 'プロ' }, { key: 'trial', label: 'トライアル' },
]
const CHANNELS: Array<{ key: OpsAnnouncementChannel; label: string }> = [
  { key: 'screen', label: '画面のお知らせ' }, { key: 'email', label: 'メール' }, { key: 'line', label: '契約者専用LINE' },
]
const STATUS_TONE: Record<OpsAnnouncement['status'], ChipTone> = { draft: 'neutral', scheduled: 'info', sending: 'warn', sent: 'ok', failed: 'danger' }

/** 板 `TJUUl`「送る前の確認」の宛先の1行。 */
function confirmAudience(form: Form, preview: OpsAudiencePreview | null): string {
  const base = form.audienceKind === 'all'
    ? 'すべての契約先'
    : form.audienceKind === 'plan'
      ? `${form.audiencePlans.map((key) => PLANS.find((p) => p.key === key)?.label ?? key).join('・')}の契約先`
      : `選んだ契約先 ${form.audienceTenantIds.length}社`
  return preview ? `${base} ${preview.tenants}社` : `${base}（数えています…）`
}

/** 板 `TJUUl`「送る前の確認」の届く方法の1行。 */
function confirmChannels(form: Form, preview: OpsAudiencePreview | null): string {
  if (!preview) return '数えています…'
  return form.channels.map((key) => {
    if (key === 'screen') return `画面 ${preview.tenants}`
    if (key === 'email') return `メール ${preview.withEmail}`
    const unlinked = Math.max(preview.staff - preview.lineLinked, 0)
    return `LINE ${preview.lineLinked}（LINE 未登録 ${unlinked}）`
  }).join('・')
}

/** 「2026-10-05T10:00」を「10/5 10:00」にする。送るボタンの文字用。 */
function shortPublishAt(local: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local.trim())
  if (!match) return local.trim()
  return `${Number(match[2])}/${Number(match[3])} ${match[4]}:${match[5]}`
}

type Form = {
  subject: string
  body: string
  audienceKind: OpsAnnouncementAudience
  audiencePlans: string[]
  audienceTenantIds: string[]
  channels: OpsAnnouncementChannel[]
  publishAt: string
}
const EMPTY: Form = { subject: '', body: '', audienceKind: 'all', audiencePlans: [], audienceTenantIds: [], channels: ['line', 'screen'], publishAt: '' }

/*
 * 一覧の読み込み失敗の説明。403・429 は説明を渡さず、ListState が捕まえた
 * 失敗から共通の1枚（権限の案内・待ち案内）を作る。それ以外は捕まえた言葉を
 * そのまま出す（通信断の「通信できませんでした」など）。
 */
function loadDescription(err: unknown): string | undefined {
  if (isForbiddenOrRateLimited(err)) return undefined
  if (err instanceof TypeError) return '通信できませんでした。ネットワークを確認してもう一度お試しください'
  if (err instanceof Error && err.message && !/^API error: /.test(err.message)) return err.message
  return undefined
}

export default function OpsAnnouncementsPage() {
  const [rows, setRows] = useState<OpsAnnouncement[]>([])
  const [loaded, setLoaded] = useState(false)
  const [lineConfigured, setLineConfigured] = useState(true)
  const [linked, setLinked] = useState<{ linked: number; total: number } | null>(null)
  const [tenants, setTenants] = useState<OpsTenantRow[]>([])
  const [form, setForm] = useState<Form>(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  /*
   * M512: 作る欄の再実行キー。二重押し・通信再送でも1件だけ作る。
   * 保存できたら・作り直すときは新しいキーに替える。
   */
  const [createKey, setCreateKey] = useState(() => crypto.randomUUID())
  /* M513: 直し始めたときの版。違う版からの保存は最新の内容つきで409になる。 */
  const [editingUpdatedAt, setEditingUpdatedAt] = useState<string | null>(null)
  const [preview, setPreview] = useState<OpsAudiencePreview | null>(null)
  const [busy, setBusy] = useState(false)
  /*
   * 失敗の表示は場所ごとに分ける。一覧の読み込み失敗（loadError）は一覧の
   * 場所に、入力の検証・保存・削除の失敗（formError）は作る欄の上に出す。
   * まとめると「件名を入力してください」で一覧まで失敗表示に変わる（監査 R154）。
   */
  const [loadError, setLoadError] = useState<unknown>(null)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmSend, setConfirmSend] = useState(false)
  const [deleting, setDeleting] = useState<OpsAnnouncement | null>(null)
  /*
   * 「直す」を押した時点の内容を基準にする。基準と違う間は、画面の外へ出る
   * 操作（左メニュー・戻る・再読込）を確認で止める（監査 R155）。
   */
  const [baseline, setBaseline] = useState<Form>(EMPTY)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await api.ops.announcements.list()
      if (!res.success) { setLoadError(new Error(res.error || '読み込めませんでした')); return }
      setRows(res.data)
      setLineConfigured(res.noticeLineConfigured)
      setLinked(res.linked)
    } catch (caught) {
      // M038：捕まえた失敗をそのまま残す。ListState が 403 は権限の案内
      // （再試行なし）・429 は待ち案内に切り替える。
      setLoadError(caught)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (form.audienceKind !== 'tenants' || tenants.length > 0) return
    void opsCall(api.ops.tenants()).then((res) => { if (res.success) setTenants(res.data.filter((t) => t.status !== 'archived')) })
  }, [form.audienceKind, tenants.length])

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    void opsCall(api.ops.announcements.preview({ audienceKind: form.audienceKind, audiencePlans: form.audiencePlans, audienceTenantIds: form.audienceTenantIds })).then((res) => {
      if (!cancelled && res.success) setPreview(res.data)
    })
    return () => { cancelled = true }
  }, [form.audienceKind, form.audiencePlans, form.audienceTenantIds])

  const toggle = <T extends string>(list: T[], key: T): T[] => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key])

  const validation = useMemo(() => {
    if (!form.subject.trim()) return '件名を入力してください'
    if (!form.body.trim()) return '本文を入力してください'
    if (form.channels.length === 0) return '送り方を 1 つ以上選んでください'
    if (form.audienceKind === 'plan' && form.audiencePlans.length === 0) return 'プランを 1 つ以上選んでください'
    if (form.audienceKind === 'tenants' && form.audienceTenantIds.length === 0) return '契約先を 1 つ以上選んでください'
    if (form.channels.includes('line') && !lineConfigured) return '契約者専用LINEのアカウントが未設定です。メンバー管理の「運営の情報」で指定してください'
    return ''
  }, [form, lineConfigured])

  const input = (mode: OpsAnnouncementInput['mode']): OpsAnnouncementInput => ({
    subject: form.subject.trim(), body: form.body.trim(), audienceKind: form.audienceKind,
    audiencePlans: form.audiencePlans, audienceTenantIds: form.audienceTenantIds, channels: form.channels,
    publishAt: toPublishAt(form.publishAt), mode,
  })

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(baseline), [form, baseline])
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({
    dirty,
    busy,
    onDiscard: () => { setForm(baseline) },
  })

  const submit = async (mode: OpsAnnouncementInput['mode']) => {
    if (validation) { setFormError(validation); return }
    setBusy(true)
    setFormError('')
    setConfirmSend(false)
    try {
      const res = editingId
        ? await api.ops.announcements.update(editingId, input(mode), editingUpdatedAt ?? undefined)
        : await api.ops.announcements.create(input(mode), createKey)
      if (!res.success) { setFormError('保存できませんでした'); return }
      setNotice(mode === 'draft' ? '下書きとして保存しました' : mode === 'schedule' ? `${formatDateTime(res.data.publishAt)} に配信を予約しました` : `送りました（${res.data.recipientsTotal}人。LINE ${res.data.lineSent}・メール ${res.data.mailSent}）`)
      setBaseline(EMPTY)
      setForm(EMPTY)
      setEditingId(null)
      setEditingUpdatedAt(null)
      setCreateKey(crypto.randomUUID())
      await load()
    } catch (error) {
      // M512/M513: 二重押しの取り違え・ほかの人の先行保存は理由を言い分け、
      // 最新の一覧を見せる。入力は残したまま保存し直せる。
      if (error instanceof ApiError && error.status === 409) {
        if (error.code === 'IDEMPOTENCY_CONFLICT') {
          setFormError('同じ再実行キーが別の内容に使われています。作り直してください。')
          setCreateKey(crypto.randomUUID())
          return
        }
        const latest = (error.data as { latest?: { updatedAt?: string } } | null)?.latest
        if (latest?.updatedAt) setEditingUpdatedAt(latest.updatedAt)
        setFormError(error.message && !error.message.startsWith('API error:')
          ? error.message
          : 'ほかの人が先に保存しました。一覧を読み直してから、もう一度保存してください。入力した内容はそのまま残っています。')
        await load()
        return
      }
      setFormError(error instanceof ApiError ? opsErrorMessage(error) : '保存できませんでした')
    } finally {
      setBusy(false)
    }
  }

  const edit = (a: OpsAnnouncement) => {
    const loaded: Form = { subject: a.subject, body: a.body, audienceKind: a.audienceKind, audiencePlans: a.audiencePlans, audienceTenantIds: a.audienceTenantIds, channels: a.channels, publishAt: toLocalInput(a.publishAt) }
    setEditingId(a.id)
    setEditingUpdatedAt(a.updatedAt)
    setBaseline(loaded)
    setForm(loaded)
    setFormError('')
    setNotice('')
    // 運営コンソールは本文（#ops-main）の中だけが縦に流れる。窓ごと動かしても
    // 先頭には戻らないので、本文の入れ物を先頭へ戻す（無ければ窓を動かす）。
    const scroller = document.getElementById('ops-main')
    if (scroller) scroller.scrollTo({ top: 0 })
    else window.scrollTo({ top: 0 })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditingUpdatedAt(null)
    setBaseline(EMPTY)
    setForm(EMPTY)
    setFormError('')
    setCreateKey(crypto.randomUUID())
  }

  const remove = async () => {
    if (!deleting) return
    setBusy(true)
    const res = await opsCall(api.ops.announcements.remove(deleting.id))
    setBusy(false)
    if (!res.success) { setFormError(res.error || '消せませんでした'); return }
    setDeleting(null)
    if (editingId === deleting.id) { setEditingId(null); setBaseline(EMPTY); setForm(EMPTY) }
    await load()
  }

  const scheduled = form.publishAt.trim().length > 0

  return (
    <div data-design-node="tQ2MJ" className="ops-ann-page">
      <PageHeader breadcrumb={[]} title="お知らせ" description="契約先へ、画面のお知らせ・メール・契約者専用LINE でお知らせを送ります。" />
      {notice ? <p role="status" className="text-caption text-accent-deep">{notice}</p> : null}
      <div className="ops-ann-columns">
        <section aria-label="作成" className="ops-ann-form">
          <h2 className="text-label font-semibold text-ink">{editingId ? 'お知らせを直す' : '作成'}</h2>
          {formError ? <p role="alert" className="text-caption text-danger">{formError}</p> : null}
          <label className="ops-ann-field">
            <span>件名</span>
            <TextField value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="例：9月20日 深夜のメンテナンスのお知らせ" maxLength={120} disabled={busy} />
          </label>
          <label className="ops-ann-field">
            <span>本文</span>
            <TextArea rows={4} className="ops-ann-body" value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder="お客様各位　いつも musubo をご利用いただきありがとうございます。…" maxLength={4000} disabled={busy} />
          </label>
          <div className="ops-ann-field">
            <div className="flex items-center gap-2"><span>宛先</span><HelpTip label="宛先の見込み">{previewLabel(preview, form.channels)}</HelpTip></div>
            <RadioCardGroup legend="宛先" className="ops-ann-choices">
              {AUDIENCES.map((a) => <RadioCard key={a.key} name="announcement-audience" value={a.key} title={a.label} checked={form.audienceKind === a.key} disabled={busy} className="ops-ann-radio" onChange={() => setForm((f) => ({ ...f, audienceKind: a.key }))} />)}
            </RadioCardGroup>
            {form.audienceKind === 'plan' ? <div className="ops-ann-choices">{PLANS.map((p) => <FilterChip key={p.key} selected={form.audiencePlans.includes(p.key)} onChange={() => setForm((f) => ({ ...f, audiencePlans: toggle(f.audiencePlans, p.key) }))}>{p.label}</FilterChip>)}</div> : null}
            {form.audienceKind === 'tenants' ? <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">{tenants.length === 0 ? <span className="text-micro text-ink-faint">契約先を読み込んでいます…</span> : tenants.map((t) => <FilterChip key={t.id} selected={form.audienceTenantIds.includes(t.id)} onChange={() => setForm((f) => ({ ...f, audienceTenantIds: toggle(f.audienceTenantIds, t.id) }))}>{t.name}</FilterChip>)}</div> : null}
          </div>
          <div className="ops-ann-field">
            <span>送り方</span>
            <div className="ops-ann-choices">{CHANNELS.map((ch) => <Checkbox key={ch.key} checked={form.channels.includes(ch.key)} disabled={busy} onCheckedChange={() => setForm((f) => ({ ...f, channels: toggle(f.channels, ch.key) }))}>{ch.label}</Checkbox>)}</div>
          </div>
          {loaded && !lineConfigured ? <NoteBar tone="warn">契約者専用LINEのアカウントが未設定です。メンバー管理の「運営の情報」で指定すると LINE で送れます。</NoteBar> : null}
          <div className="ops-ann-field">
            <div className="flex items-center gap-2"><span>配信日時（日本時間）</span><HelpTip label="配信日時の説明">空のままなら今すぐ送る。日時を入れると「配信を予約する」に変わります。</HelpTip></div>
            <DateTimeField value={form.publishAt} onChange={(v) => setForm((f) => ({ ...f, publishAt: v }))} aria-label="公開日時（日本時間）" placeholder="空のままなら今すぐ送る" disabled={busy} />
          </div>
          <div className="ops-ann-actions">
            {editingId ? <Button onClick={cancelEdit} disabled={busy}>直すのをやめる</Button> : null}
            <Button onClick={() => void submit('draft')} disabled={busy}>下書きを保存する</Button>
            <Button variant="primary" onClick={() => (scheduled ? void submit('schedule') : setConfirmSend(true))} disabled={busy}><Send aria-hidden="true" className="h-4 w-4" />{scheduled ? '配信を予約する' : '今すぐ送る'}</Button>
          </div>
        </section>
        <section aria-label="配信済みの表" className="ops-ann-list">
          <header className="flex items-center gap-2"><h3 className="text-label font-semibold text-ink">配信済み・予約・下書き</h3><HelpTip label="契約者専用LINEの登録状況">{linked ? `契約者専用LINEの登録 ${linked.linked}人 / ${linked.total}人` : '登録状況を読み込んでいます'}</HelpTip></header>
          {!loaded ? <ListState kind="loading" title="読み込んでいます" /> : loadError ? <ListState kind="error" title="お知らせを表示できませんでした" description={loadDescription(loadError)} error={loadError ?? undefined} onRetry={() => void load()} /> : rows.length === 0 ? <ListState kind="empty" title="まだお知らせはありません" description="左で作って「今すぐ送る」か「配信を予約する」を押すと、ここに並びます。" /> : (
            <DataTable className="ops-ann-table">
              <thead><TableHeadRow><Th>件名</Th><Th className="ops-ann-audience">宛先</Th><Th className="ops-ann-status">状態</Th><Th align="right" className="ops-ann-number">画面で既読</Th><Th align="right" className="ops-ann-number">LINE送達</Th><Th className="ops-ann-operation">操作</Th></TableHeadRow></thead>
              <tbody>{rows.map((a) => <Tr key={a.id}>
                <Td><span className="block truncate font-semibold" title={a.subject}>{a.subject}</span><span className="block truncate text-micro text-ink-faint" title={`${a.channelLabels.join('・')} ${formatDateTime(a.sentAt ?? a.publishAt)}${a.lastError ? `・${a.lastError}` : ''}`}>{formatDateTime(a.sentAt ?? a.publishAt)}{a.status === 'scheduled' ? ' 予約' : ''}{a.lastError ? `・${a.lastError}` : ''}</span></Td>
                <Td><span className="block truncate" title={a.audienceLabel}>{a.audienceKind === 'all' ? 'すべて' : a.audienceLabel}</span></Td>
                <Td><Chip tone={STATUS_TONE[a.status]}>{a.statusLabel}</Chip></Td>
                <Td align="right">{a.channels.includes('screen') && a.status === 'sent' ? `${a.screenRead} / ${a.screenTotal}` : '—'}</Td>
                <Td align="right">{a.channels.includes('line') && a.status === 'sent' ? `${a.lineSent} / ${a.recipientsTotal}` : '—'}</Td>
                <Td>{a.status === 'draft' || a.status === 'scheduled' ? <div className="flex flex-wrap gap-2"><Button size="field" onClick={() => edit(a)} disabled={busy}>直す</Button><Button size="field" onClick={() => setDeleting(a)} disabled={busy}>削除する</Button></div> : null}</Td>
              </Tr>)}</tbody>
            </DataTable>
          )}
          <p className="text-micro text-ink-secondary">下書き・予約は消せます。配信済みのものは消せません。</p>
        </section>
      </div>

      <Dialog
        open={confirmSend}
        title="このお知らせを送りますか？"
        cancelLabel="戻って直す"
        confirmLabel={scheduled ? `${shortPublishAt(form.publishAt)}に送る` : '今すぐ送る'}
        confirmIcon={<Send size={16} aria-hidden="true" />}
        busy={busy}
        error={formError || undefined}
        designNode="TJUUl"
        onConfirm={() => void submit('send')}
        onCancel={() => { if (!busy) setConfirmSend(false) }}
      >
        <div className="flex flex-col gap-4">
          <dl className="grid gap-1.5 rounded-card bg-canvas-sunken px-4 py-3">
            <div className="flex gap-3">
              <dt className="w-16 shrink-0 text-caption text-ink-faint">宛先</dt>
              <dd className="text-caption font-medium text-ink">{confirmAudience(form, preview)}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-16 shrink-0 text-caption text-ink-faint">届く方法</dt>
              <dd className="text-caption font-medium text-ink">{confirmChannels(form, preview)}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-16 shrink-0 text-caption text-ink-faint">送る日時</dt>
              <dd className="text-caption font-medium text-ink">{scheduled ? `${formatDateTime(toPublishAt(form.publishAt))}（予約）` : '今すぐ送る'}</dd>
            </div>
          </dl>
          <div>
            <p className="text-label font-semibold text-ink">件名：{form.subject.trim()}</p>
            <p className="mt-1 text-caption text-ink-secondary">{form.body.trim().length > 80 ? `${form.body.trim().slice(0, 80)} …` : form.body.trim()}</p>
          </div>
          <p className="text-caption text-ink-secondary">送ったあとは本文を直せません。画面のお知らせは取り下げられます（メール・LINE は取り消せません）。</p>
        </div>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? `「${deleting.subject}」を消しますか？` : ''}
        description="下書き・予約を消します。配信済みのものは消せません。"
        confirmLabel="削除する"
        destructive
        busy={busy}
        error={formError}
        onConfirm={() => void remove()}
        onCancel={() => { if (!busy) setDeleting(null) }}
      />
      <UnsavedLeaveDialog open={leaveTarget !== null} onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}
