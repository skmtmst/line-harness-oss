'use client'

import { Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  api,
  type OpsAnnouncement,
  type OpsAnnouncementAudience,
  type OpsAnnouncementChannel,
  type OpsAnnouncementInput,
  type OpsAudiencePreview,
  type OpsTenantRow,
} from '@/lib/api'
import OpsPageHeader from '@/components/ops/ops-page-header'
import { formatDateTime, opsCall } from '@/components/ops/ops-ui'
import { previewLabel, toLocalInput, toPublishAt } from './format'
import Button from '@/components/shared/button'
import Chip, { type ChipTone } from '@/components/shared/chip'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextArea, TextField } from '@/components/shared/text-field'

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
  { key: 'line', label: '契約者専用LINE' }, { key: 'screen', label: '画面のお知らせ' }, { key: 'email', label: 'メール' },
]
const STATUS_TONE: Record<OpsAnnouncement['status'], ChipTone> = { draft: 'neutral', scheduled: 'info', sending: 'warn', sent: 'ok', failed: 'danger' }

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

export default function OpsAnnouncementsPage() {
  const [rows, setRows] = useState<OpsAnnouncement[]>([])
  const [loaded, setLoaded] = useState(false)
  const [lineConfigured, setLineConfigured] = useState(true)
  const [linked, setLinked] = useState<{ linked: number; total: number } | null>(null)
  const [tenants, setTenants] = useState<OpsTenantRow[]>([])
  const [form, setForm] = useState<Form>(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [preview, setPreview] = useState<OpsAudiencePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmSend, setConfirmSend] = useState(false)
  const [deleting, setDeleting] = useState<OpsAnnouncement | null>(null)

  const load = useCallback(async () => {
    setError('')
    const res = await opsCall(api.ops.announcements.list())
    setLoaded(true)
    if (!res.success) { setError(res.error || '読み込めませんでした'); return }
    setRows(res.data)
    setLineConfigured(res.noticeLineConfigured)
    setLinked(res.linked)
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

  const submit = async (mode: OpsAnnouncementInput['mode']) => {
    if (validation) { setError(validation); return }
    setBusy(true)
    setError('')
    const res = await opsCall(editingId ? api.ops.announcements.update(editingId, input(mode)) : api.ops.announcements.create(input(mode)))
    setBusy(false)
    setConfirmSend(false)
    if (!res.success) { setError(res.error || '保存できませんでした'); return }
    setNotice(mode === 'draft' ? '下書きとして保存しました' : mode === 'schedule' ? `${formatDateTime(res.data.publishAt)} に配信を予約しました` : `送りました（${res.data.recipientsTotal}人。LINE ${res.data.lineSent}・メール ${res.data.mailSent}）`)
    setForm(EMPTY)
    setEditingId(null)
    await load()
  }

  const edit = (a: OpsAnnouncement) => {
    setEditingId(a.id)
    setForm({ subject: a.subject, body: a.body, audienceKind: a.audienceKind, audiencePlans: a.audiencePlans, audienceTenantIds: a.audienceTenantIds, channels: a.channels, publishAt: toLocalInput(a.publishAt) })
    setNotice('')
    window.scrollTo({ top: 0 })
  }

  const remove = async () => {
    if (!deleting) return
    setBusy(true)
    const res = await opsCall(api.ops.announcements.remove(deleting.id))
    setBusy(false)
    if (!res.success) { setError(res.error || '消せませんでした'); return }
    setDeleting(null)
    if (editingId === deleting.id) { setEditingId(null); setForm(EMPTY) }
    await load()
  }

  const scheduled = form.publishAt.trim().length > 0

  return (
    <div data-design-node="q2CokV">
      <OpsPageHeader
        title="お知らせ"
        actions={
          <>
            <Button onClick={() => void submit('draft')} disabled={busy}>下書きとして保存</Button>
            <Button variant="primary" onClick={() => (scheduled ? void submit('schedule') : setConfirmSend(true))} disabled={busy}>
              <Send aria-hidden="true" className="h-4 w-4" />
              {scheduled ? '配信を予約する' : '今すぐ送る'}
            </Button>
          </>
        }
      />
      <h2 className="mb-3 text-body font-bold text-ink">{editingId ? 'お知らせを直す' : 'お知らせを作る'}</h2>

      {!lineConfigured ? (
        <div className="mb-4"><NoteBar tone="warn">契約者専用LINEのアカウントが未設定です。メンバー管理の「運営の情報」で、運営会社に登録した公式アカウントを指定すると LINE で送れます。</NoteBar></div>
      ) : null}
      {notice ? <p role="status" className="mb-3 text-caption text-accent-deep">{notice}</p> : null}
      {error ? <p role="alert" className="mb-3 text-caption text-danger">{error}</p> : null}

      <div className="grid gap-4 xl:grid-cols-5">
        <section aria-label="作成" className="grid gap-4 rounded-card border border-hairline bg-canvas p-5 xl:col-span-2">
          <div className="grid gap-2">
            <span className="text-label font-bold text-ink">宛先</span>
            <div className="flex flex-wrap gap-1.5">
              {AUDIENCES.map((a) => (
                <FilterChip key={a.key} selected={form.audienceKind === a.key} onChange={(sel) => { if (sel) setForm((f) => ({ ...f, audienceKind: a.key })) }}>{a.label}</FilterChip>
              ))}
            </div>
            {form.audienceKind === 'plan' ? (
              <div className="flex flex-wrap gap-1.5">
                {PLANS.map((p) => (
                  <FilterChip key={p.key} selected={form.audiencePlans.includes(p.key)} onChange={() => setForm((f) => ({ ...f, audiencePlans: toggle(f.audiencePlans, p.key) }))}>{p.label}</FilterChip>
                ))}
              </div>
            ) : null}
            {form.audienceKind === 'tenants' ? (
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto rounded-control border border-hairline p-2">
                {tenants.length === 0 ? <span className="text-micro text-ink-faint">契約先を読み込んでいます…</span> : tenants.map((t) => (
                  <FilterChip key={t.id} selected={form.audienceTenantIds.includes(t.id)} onChange={() => setForm((f) => ({ ...f, audienceTenantIds: toggle(f.audienceTenantIds, t.id) }))}>{t.name}</FilterChip>
                ))}
              </div>
            ) : null}
            <p className="text-micro text-ink-faint">{previewLabel(preview, form.channels)}</p>
          </div>

          <label className="grid gap-1.5">
            <span className="text-label font-bold text-ink">件名</span>
            <TextField value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="例：9月20日 深夜のメンテナンスのお知らせ" maxLength={120} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-label font-bold text-ink">本文</span>
            <TextArea rows={7} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder="お客様各位　いつもmusuboをご利用いただきありがとうございます。…" maxLength={4000} />
          </label>
          <div className="grid gap-1.5">
            <span className="text-label font-bold text-ink">送り方</span>
            <div className="flex flex-wrap gap-1.5">
              {CHANNELS.map((ch) => (
                <FilterChip key={ch.key} selected={form.channels.includes(ch.key)} onChange={() => setForm((f) => ({ ...f, channels: toggle(f.channels, ch.key) }))}>{ch.label}</FilterChip>
              ))}
            </div>
          </div>
          <label className="grid gap-1.5">
            <span className="text-label font-bold text-ink">公開日時</span>
            <TextField type="datetime-local" value={form.publishAt} onChange={(e) => setForm((f) => ({ ...f, publishAt: e.target.value }))} aria-label="公開日時（日本時間）" />
            <span className="text-micro text-ink-faint">空のまま「今すぐ送る」を押すとすぐに送ります。日時を入れると「配信を予約する」に変わります（日本時間）。</span>
          </label>
          {editingId ? <Button onClick={() => { setEditingId(null); setForm(EMPTY) }}>直すのをやめる</Button> : null}
        </section>

        <section aria-label="配信済みの表" className="rounded-card border border-hairline bg-canvas xl:col-span-3">
          <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <h3 className="text-label font-bold text-ink">配信済み・予約・下書き</h3>
            <span className="text-micro text-ink-faint">{linked ? `契約者専用LINEの登録 ${linked.linked}人 / ${linked.total}人` : ''}</span>
          </header>
          {!loaded ? (
            <ListState kind="loading" title="読み込んでいます" />
          ) : error && rows.length === 0 ? (
            // 「まだ無い」と「読み込めなかった」を言い分ける。失敗時は空の案内ではなくエラーと再読み込みを出す。
            <ListState kind="error" title="お知らせを表示できませんでした" onRetry={() => void load()} />
          ) : rows.length === 0 ? (
            <ListState kind="empty" title="まだお知らせはありません" description="左で作って「今すぐ送る」か「配信を予約する」を押すと、ここに並びます。" />
          ) : (
            <DataTable>
              <thead>
                <TableHeadRow>
                  {/*
                   * ★V7：1440pxで表の枠（652px）に収める。宛先は件名の下へ畳み、
                   * 日時は日付と時刻の2段にし、操作列だけ固定幅にする。
                   * 幅の指定は先頭行（Th）だけに書く（table-fixed では行側は効かない）。
                   */}
                  <Th>件名</Th>
                  <Th className="w-20">状態</Th>
                  <Th className="w-24">配信日時</Th>
                  <Th className="w-20">LINE送達</Th>
                  <Th className="w-24">画面で既読</Th>
                  <Th align="right" className="w-40">操作</Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <Tr key={a.id}>
                    <Td>
                      <span className="block truncate text-label font-bold text-ink" title={a.subject}>{a.subject}</span>
                      <span
                        className="block truncate text-micro text-ink-faint"
                        title={`${a.channelLabels.join('・')}・${a.audienceLabel}${a.lastError ? `・${a.lastError}` : ''}`}
                      >
                        {a.channelLabels.join('・')}・{a.audienceLabel}{a.lastError ? `・${a.lastError}` : ''}
                      </span>
                    </Td>
                    <Td><Chip tone={STATUS_TONE[a.status]}>{a.statusLabel}</Chip></Td>
                    <Td>
                      {(() => {
                        const label = formatDateTime(a.sentAt ?? a.publishAt)
                        const [date, time] = label.split(' ')
                        return (
                          <span className="block whitespace-nowrap text-caption text-ink-secondary" title={label}>
                            {date}
                            {time ? <><br />{time}</> : null}
                          </span>
                        )
                      })()}
                    </Td>
                    <Td><span className="whitespace-nowrap text-caption text-ink">{a.channels.includes('line') && a.status === 'sent' ? `${a.lineSent} / ${a.recipientsTotal}` : '—'}</span></Td>
                    <Td><span className="whitespace-nowrap text-caption text-ink">{a.channels.includes('screen') && a.status === 'sent' ? `${a.screenRead} / ${a.screenTotal}` : '—'}</span></Td>
                    <Td align="right">
                      {a.status === 'draft' || a.status === 'scheduled' ? (
                        <span className="inline-flex gap-2">
                          <Button size="field" onClick={() => edit(a)} disabled={busy}>直す</Button>
                          <Button size="field" onClick={() => setDeleting(a)} disabled={busy}>消す</Button>
                        </span>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirmSend}
        title="今すぐ送りますか？"
        description={`${previewLabel(preview, form.channels)}。送ったあとは取り消せません。`}
        confirmLabel="送る"
        busy={busy}
        error={error}
        onConfirm={() => void submit('send')}
        onCancel={() => { if (!busy) setConfirmSend(false) }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? `「${deleting.subject}」を消しますか？` : ''}
        description="下書き・予約を消します。配信済みのものは消せません。"
        confirmLabel="消す"
        destructive
        busy={busy}
        error={error}
        onConfirm={() => void remove()}
        onCancel={() => { if (!busy) setDeleting(null) }}
      />
    </div>
  )
}
