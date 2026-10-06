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
import { formatDateTime, opsCall, opsErrorMessage } from '@/components/ops/ops-ui'
import { opsEnvironmentLabel } from '@/components/ops/ops-env-bar'
import { isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import DateTimeField from '@/components/shared/date-time-field'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import Radio from '@/components/shared/radio'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { TextArea, TextField } from '@/components/shared/text-field'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { OpsHead } from './shell'
import { useOpsReadOnly } from './use-ops-read-only'
import parts from './parts.module.css'
import styles from './announcements.module.css'

/**
 * 運営のお知らせ配信 V8（絵 `tQ2MJ`・送る前の確認 `TJUUl`）。
 *
 * 動きは v7（app/ops/announcements）と同じ口：一覧・宛先の見込み（preview）・作る・直す・消す。
 * 左で作り、右に配信済み・予約・下書き。送る（今すぐ・予約）ときは必ず「送る前の確認」を挟む。
 * 下書き・予約は「直す」で左に読み込み、直している間だけ「削除する」を出す。
 * 送ったものの「直す」は中身を写して新しいお知らせを作る（送ったものは変えない）。
 * 閲覧のみの運営メンバー（readOnly）には作る欄と操作を出さない。
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
const STATUS_TONE: Record<OpsAnnouncement['status'], StatusBadgeTone> = { draft: 'neutral', scheduled: 'info', sending: 'warning', sent: 'success', failed: 'danger' }

type Form = {
  subject: string
  body: string
  audienceKind: OpsAnnouncementAudience
  audiencePlans: string[]
  audienceTenantIds: string[]
  channels: OpsAnnouncementChannel[]
  publishAt: string
}
const EMPTY: Form = { subject: '', body: '', audienceKind: 'all', audiencePlans: [], audienceTenantIds: [], channels: ['screen', 'email'], publishAt: '' }

/** datetime-local の値（日本時間）を +09:00 付きの ISO に。空なら null。 */
function toPublishAt(local: string): string | null {
  const v = local.trim()
  if (!v) return null
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? `${v.slice(0, 16)}:00+09:00` : v
}

function toLocalInput(iso: string | null): string {
  return iso ? iso.slice(0, 16) : ''
}

function previewLabel(p: OpsAudiencePreview | null, channels: OpsAnnouncementChannel[]): string {
  if (!p) return '宛先を数えています…'
  const words = [`${p.tenants}件の契約先・${p.staff}人の権限者`]
  if (channels.includes('line')) words.push(`うち契約者専用LINEに登録済みの${p.lineLinked}人へ届きます`)
  if (channels.includes('email')) words.push(`メールは${p.withEmail}人に届きます`)
  return words.join('。')
}

/** 「2026-10-05T10:00」を「10/5 10:00」にする。送るボタンの文字用。 */
function shortPublishAt(local: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local.trim())
  if (!match) return local.trim()
  return `${Number(match[2])}/${Number(match[3])} ${match[4]}:${match[5]}`
}

/** 「10/5（月）10:00」の形。 */
function longPublishAt(local: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local.trim())
  if (!match) return local.trim()
  const week = '日月火水木金土'[new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getDay()]
  return `${Number(match[2])}/${Number(match[3])}（${week}）${match[4]}:${match[5]}`
}

/** 一覧の小さい日時（9/18 10:00）。 */
function shortDateTime(value: string | null): string {
  if (!value) return '—'
  const full = formatDateTime(value)
  const m = full.match(/^(\d+)-(\d+)-(\d+) (\d+:\d+)$/)
  return m ? `${Number(m[2])}/${Number(m[3])} ${m[4]}` : full
}

function confirmAudience(form: Form, preview: OpsAudiencePreview | null): string {
  const base = form.audienceKind === 'all'
    ? 'すべての契約先'
    : form.audienceKind === 'plan'
      ? `${form.audiencePlans.map((key) => PLANS.find((p) => p.key === key)?.label ?? key).join('・')}の契約先`
      : '選んだ契約先'
  return preview ? `${base} ${preview.tenants} 社` : `${base}（数えています…）`
}

function confirmChannels(form: Form, preview: OpsAudiencePreview | null): string {
  if (!preview) return '数えています…'
  return form.channels.map((key) => {
    if (key === 'screen') return `画面 ${preview.tenants}`
    if (key === 'email') return `メール ${preview.withEmail}`
    const unlinked = Math.max(preview.staff - preview.lineLinked, 0)
    return `LINE ${preview.lineLinked}（LINE 未登録 ${unlinked}）`
  }).join('・')
}

function loadDescription(err: unknown): string | undefined {
  if (isForbiddenOrRateLimited(err)) return undefined
  if (err instanceof TypeError) return '通信できませんでした。ネットワークを確認してもう一度お試しください'
  if (err instanceof Error && err.message && !/^API error: /.test(err.message)) return err.message
  return undefined
}

export default function OpsAnnouncementsV8() {
  const [rows, setRows] = useState<OpsAnnouncement[]>([])
  const [loaded, setLoaded] = useState(false)
  const [lineConfigured, setLineConfigured] = useState(true)
  const [linked, setLinked] = useState<{ linked: number; total: number } | null>(null)
  const [tenants, setTenants] = useState<OpsTenantRow[]>([])
  const [form, setForm] = useState<Form>(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  // 作る欄の再実行キー。二重押し・通信再送でも1件だけ作る。
  const [createKey, setCreateKey] = useState(() => crypto.randomUUID())
  // 直し始めたときの版。違う版からの保存は最新の内容つきで409になる。
  const [editingUpdatedAt, setEditingUpdatedAt] = useState<string | null>(null)
  const [preview, setPreview] = useState<OpsAudiencePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmSend, setConfirmSend] = useState(false)
  const [deleting, setDeleting] = useState<OpsAnnouncement | null>(null)
  const [baseline, setBaseline] = useState<Form>(EMPTY)
  const readOnly = useOpsReadOnly()

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await api.ops.announcements.list()
      if (!res.success) { setLoadError(new Error(res.error || '読み込めませんでした')); return }
      setRows(res.data)
      setLineConfigured(res.noticeLineConfigured)
      setLinked(res.linked)
    } catch (caught) {
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
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy, onDiscard: () => { setForm(baseline) } })

  const submit = async (mode: OpsAnnouncementInput['mode']) => {
    if (validation) { setFormError(validation); setConfirmSend(false); return }
    setBusy(true)
    setFormError('')
    try {
      const res = editingId
        ? await api.ops.announcements.update(editingId, input(mode), editingUpdatedAt ?? undefined)
        : await api.ops.announcements.create(input(mode), createKey)
      if (!res.success) { setFormError('保存できませんでした'); return }
      setConfirmSend(false)
      setNotice(mode === 'draft' ? '下書きとして保存しました' : mode === 'schedule' ? `${formatDateTime(res.data.publishAt)} に配信を予約しました` : `送りました（${res.data.recipientsTotal}人。LINE ${res.data.lineSent}・メール ${res.data.mailSent}）`)
      setBaseline(EMPTY)
      setForm(EMPTY)
      setEditingId(null)
      setEditingUpdatedAt(null)
      setCreateKey(crypto.randomUUID())
      await load()
    } catch (error) {
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
    const next: Form = { subject: a.subject, body: a.body, audienceKind: a.audienceKind, audiencePlans: a.audiencePlans, audienceTenantIds: a.audienceTenantIds, channels: a.channels, publishAt: toLocalInput(a.publishAt) }
    setEditingId(a.id)
    setEditingUpdatedAt(a.updatedAt)
    setBaseline(next)
    setForm(next)
    setFormError('')
    setNotice('')
    const scroller = document.getElementById('ops-main')
    if (scroller) scroller.scrollTo({ top: 0 })
    else window.scrollTo({ top: 0 })
  }

  // 送ったものは直せない。中身を左へ写し、新しいお知らせとして作り直す。
  const copyAsNew = (a: OpsAnnouncement) => {
    const next: Form = { subject: a.subject, body: a.body, audienceKind: a.audienceKind, audiencePlans: a.audiencePlans, audienceTenantIds: a.audienceTenantIds, channels: a.channels, publishAt: '' }
    setEditingId(null)
    setEditingUpdatedAt(null)
    setCreateKey(crypto.randomUUID())
    setBaseline(EMPTY)
    setForm(next)
    setFormError('')
    setNotice('送ったお知らせの中身を写しました。直して送ると、新しいお知らせになります')
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
  const editing = rows.find((a) => a.id === editingId) ?? null

  return (
    <div data-design-node="tQ2MJ">
      <OpsHead
        title="お知らせ"
        description="契約先へ、画面のお知らせ・メール・契約者専用LINE でお知らせを送ります。"
        environment={opsEnvironmentLabel(process.env.NEXT_PUBLIC_API_URL)}
      />
      {notice ? <p role="status" className={`${parts.status} ${styles.notice}`}>{notice}</p> : null}
      <div className={styles.columns}>
        {readOnly ? null : (
          <section aria-label="作成" className={styles.form}>
            <h2 className={parts.panelTitle}>{editingId ? 'お知らせを直す' : '作成'}</h2>
            {formError && !confirmSend ? <p role="alert" className={parts.alert}>{formError}</p> : null}
            <label className={styles.field}>
              <span className={styles.label}>件名</span>
              <TextField value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="例：9月20日 深夜のメンテナンスのお知らせ" maxLength={120} disabled={busy} />
            </label>
            <label className={styles.field}>
              <span className={styles.smallLabel}>本文</span>
              <TextArea rows={4} className={styles.body} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder="お客様各位　いつも musubo をご利用いただきありがとうございます。…" maxLength={4000} disabled={busy} />
            </label>
            <fieldset className={styles.field}>
              <legend className={`${styles.smallLabel} ${styles.legend}`}>
                宛先
                <HelpTip label="宛先の見込み">{previewLabel(preview, form.channels)}</HelpTip>
              </legend>
              <div className={styles.choices}>
                {AUDIENCES.map((a) => (
                  <Radio key={a.key} name="announcement-audience" value={a.key} checked={form.audienceKind === a.key} disabled={busy} onChange={() => setForm((f) => ({ ...f, audienceKind: a.key }))}>{a.label}</Radio>
                ))}
              </div>
              {form.audienceKind === 'plan' ? (
                <div className={styles.chips}>
                  {PLANS.map((p) => <FilterChip key={p.key} selected={form.audiencePlans.includes(p.key)} onChange={() => setForm((f) => ({ ...f, audiencePlans: toggle(f.audiencePlans, p.key) }))}>{p.label}</FilterChip>)}
                </div>
              ) : null}
              {form.audienceKind === 'tenants' ? (
                <div className={`${styles.chips} ${styles.tenantChips}`}>
                  {tenants.length === 0
                    ? <span className={parts.note}>契約先を読み込んでいます…</span>
                    : tenants.map((t) => <FilterChip key={t.id} selected={form.audienceTenantIds.includes(t.id)} onChange={() => setForm((f) => ({ ...f, audienceTenantIds: toggle(f.audienceTenantIds, t.id) }))}>{t.name}</FilterChip>)}
                </div>
              ) : null}
            </fieldset>
            <fieldset className={styles.field}>
              <legend className={`${styles.smallLabel} ${styles.legend}`}>送り方</legend>
              <div className={styles.choices}>
                {CHANNELS.map((ch) => <Checkbox key={ch.key} checked={form.channels.includes(ch.key)} disabled={busy} onCheckedChange={() => setForm((f) => ({ ...f, channels: toggle(f.channels, ch.key) }))}>{ch.label}</Checkbox>)}
              </div>
            </fieldset>
            {loaded && !lineConfigured ? (
              <p className={styles.warn}>契約者専用LINE のアカウントが未設定です。メンバー管理の「運営の情報」で指定すると LINE で送れます。</p>
            ) : null}
            <div className={styles.field}>
              <span className={styles.label}>
                配信日時（日本時間）
                <HelpTip label="配信日時の説明">空のままなら、押したときにすぐ送ります。日時を入れると「配信を予約する」に変わります。</HelpTip>
              </span>
              <div className={styles.dateTime}>
              <DateTimeField value={form.publishAt} onChange={(v) => setForm((f) => ({ ...f, publishAt: v }))} aria-label="公開日時（日本時間）" placeholder="空のままならすぐに送る" disabled={busy} />
              </div>
            </div>
            <div className={styles.actions}>
              {editingId ? <Button onClick={cancelEdit} disabled={busy}>直すのをやめる</Button> : null}
              {editing ? <Button variant="danger" onClick={() => setDeleting(editing)} disabled={busy}>削除する</Button> : null}
              <Button onClick={() => void submit('draft')} disabled={busy}>下書きを保存する</Button>
              <Button variant="primary" onClick={() => { setFormError(''); setConfirmSend(true) }} disabled={busy}>
                <Send aria-hidden="true" />{scheduled ? '配信を予約する' : '今すぐ送る'}
              </Button>
            </div>
          </section>
        )}
        <section aria-label="配信済みの表" className={styles.list}>
          <div className={styles.listHead}>
            <h3 className={parts.panelTitle}>配信済み・予約・下書き</h3>
            <HelpTip label="契約者専用LINEの登録状況">{linked ? `契約者専用LINEの登録 ${linked.linked}人 / ${linked.total}人` : '登録状況を読み込んでいます'}</HelpTip>
          </div>
          {!loaded ? (
            <ListState kind="loading" title="読み込んでいます" />
          ) : loadError ? (
            <div className={parts.panel}>
              <ListState kind="error" title="お知らせを表示できませんでした" description={loadDescription(loadError)} error={loadError ?? undefined} onRetry={() => void load()} />
            </div>
          ) : rows.length === 0 ? (
            <div className={parts.panel}>
              <ListState kind="empty" title="まだお知らせはありません" description="左で作って「今すぐ送る」か「配信を予約する」を押すと、ここに並びます。" />
            </div>
          ) : (
            <div className={parts.mini} role="table" aria-label="配信済み・予約・下書き">
              <div className={parts.miniHead} role="row">
                <span className={parts.grow} role="columnheader">件名</span>
                <span className={`${parts.fixed} ${styles.colTo}`} role="columnheader">宛先</span>
                <span className={`${parts.fixed} ${styles.colState}`} role="columnheader">状態</span>
                <span className={`${parts.num} ${styles.colRead}`} role="columnheader">画面で既読</span>
                <span className={`${parts.num} ${styles.colLine}`} role="columnheader">LINE送達</span>
                <span className={`${parts.fixed} ${styles.colOps}`} role="columnheader">操作</span>
              </div>
              {rows.map((a) => (
                <div key={a.id} className={`${parts.miniRow} ${styles.row}`} role="row">
                  <span className={`${parts.grow} ${styles.subject}`} role="cell">
                    <span className={styles.subjectText} title={a.subject}>{a.subject}</span>
                    <span className={styles.sub} title={`${a.channelLabels.join('・')} ${formatDateTime(a.sentAt ?? a.publishAt)}${a.lastError ? `・${a.lastError}` : ''}`}>
                      {`${shortDateTime(a.sentAt ?? a.publishAt)}${a.status === 'scheduled' ? ' 予約' : ''}${a.lastError ? `・${a.lastError}` : ''}`}
                    </span>
                  </span>
                  <span className={`${parts.fixed} ${styles.colTo}`} role="cell" title={a.audienceLabel}>{a.audienceKind === 'all' ? 'すべて' : a.audienceLabel}</span>
                  <span className={`${parts.fixed} ${styles.colState}`} role="cell"><StatusBadge tone={STATUS_TONE[a.status]}>{a.statusLabel}</StatusBadge></span>
                  <span className={`${parts.num} ${styles.colRead}`} role="cell">{a.channels.includes('screen') && a.status === 'sent' ? `${a.screenRead}/${a.screenTotal}` : '—'}</span>
                  <span className={`${parts.num} ${styles.colLine}`} role="cell">{a.channels.includes('line') && a.status === 'sent' ? `${a.lineSent}/${a.recipientsTotal}` : '—'}</span>
                  <span className={`${parts.fixed} ${styles.colOps}`} role="cell">
                    {readOnly || a.status === 'sending'
                      ? <span className={styles.faint}>—</span>
                      : a.status === 'draft' || a.status === 'scheduled'
                        ? <Button onClick={() => edit(a)} disabled={busy} aria-label={`「${a.subject}」を直す`}>直す</Button>
                        : <Button onClick={() => copyAsNew(a)} disabled={busy} aria-label={`「${a.subject}」を元に新しく作る`} title="送ったものは直せないので、中身を写して新しいお知らせを作ります">直す</Button>}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className={parts.note}>下書き・予約は消せます。配信済みのものは消せません。</p>
        </section>
      </div>

      <Dialog
        open={confirmSend}
        designWidth={600}
        designTop={220}
        title="このお知らせを送りますか？"
        cancelLabel="戻って直す"
        confirmLabel={scheduled ? `${shortPublishAt(form.publishAt)} に送る` : '今すぐ送る'}
        confirmIcon={<Send size={15} aria-hidden="true" />}
        busy={busy}
        error={formError || undefined}
        designNode="TJUUl"
        onConfirm={() => void submit(scheduled ? 'schedule' : 'send')}
        onCancel={() => { if (!busy) setConfirmSend(false) }}
      >
        <div className={parts.dialogBody}>
          <dl className={styles.facts}>
            <div className={styles.fact}><dt>宛先</dt><dd>{confirmAudience(form, preview)}</dd></div>
            <div className={styles.fact}><dt>届く方法</dt><dd>{confirmChannels(form, preview)}</dd></div>
            <div className={styles.fact}><dt>送る日時</dt><dd>{scheduled ? `${longPublishAt(form.publishAt)}（予約）` : '今すぐ'}</dd></div>
          </dl>
          <div className={styles.letter}>
            <p className={styles.letterSubject}>{`件名：${form.subject.trim() || '（未入力）'}`}</p>
            <p className={styles.letterBody}>{form.body.trim().length > 80 ? `${form.body.trim().slice(0, 80)}…` : form.body.trim() || '（本文が未入力です）'}</p>
          </div>
          <p className={styles.after}>送ったあとは本文を直せません。画面のお知らせは取り下げられます（メール・LINE は取り消せません）。</p>
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
