'use client'

import { ImagePlus, Send, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import type { LineAccount, StaffMember } from '@line-crm/shared'
import Button from '@/components/shared/button'
import NoteBar from '@/components/shared/note-bar'
import SelectField from '@/components/shared/select-field'
import StickyBar from '@/components/shared/sticky-bar'
import { TextArea, TextField } from '@/components/shared/text-field'
import { usePageTitle } from '@/components/shell/page-chrome'
import { api } from '@/lib/api'
import { readFileAsBase64, shortDateTime } from '@/lib/hq-banners'
import {
  EMPTY_SUPPORT_INPUT,
  SUPPORT_ATTACHMENT_MAX,
  SUPPORT_BODY_MAX,
  SUPPORT_STATUS_LABELS,
  SUPPORT_SUBJECT_MAX,
  validateSupportAttachment,
  validateSupportInput,
  type HqSupportInput,
  type HqSupportKind,
  type HqSupportRequest,
} from '@/lib/hq-support'

type Attachment = { name: string; mimeType: string; data: string; size: number; previewUrl: string }

/**
 * お問い合わせ。★V6 36-3（`X6LZP`）。統括から運営（musubo 提供元）へ送る。
 *
 * E 作成型: 案内帯 → 本体（左フォーム＋右390：送信者・これまでの問い合わせ）→ 下部追従バー。
 * 送るとこの統括の記録に残り、運営へメールで知らせ、送信者には控えが届く。
 */
export default function HqSupportPage() {
  usePageTitle('お問い合わせ')
  const uid = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [kinds, setKinds] = useState<Array<{ key: HqSupportKind; label: string }>>([])
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [me, setMe] = useState<StaffMember | null>(null)
  const [tenantName, setTenantName] = useState('')
  const [history, setHistory] = useState<HqSupportRequest[] | null>(null)
  const [historyError, setHistoryError] = useState(false)
  const [input, setInput] = useState<HqSupportInput>(EMPTY_SUPPORT_INPUT)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState<HqSupportRequest | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.allSettled([api.hqSupport.kinds(), api.lineAccounts.list(), api.staff.me(), api.tenants.me()]).then(
      ([kindRes, accountRes, meRes, tenantRes]) => {
        if (cancelled) return
        if (kindRes.status === 'fulfilled' && kindRes.value.success) setKinds(kindRes.value.data)
        if (accountRes.status === 'fulfilled' && accountRes.value.success) setAccounts(accountRes.value.data)
        if (meRes.status === 'fulfilled' && meRes.value.success) setMe(meRes.value.data)
        if (tenantRes.status === 'fulfilled' && tenantRes.value.success) setTenantName(tenantRes.value.data.name)
      },
    )
    void loadHistory()
    return () => {
      cancelled = true
    }
  }, [])

  const loadHistory = async () => {
    setHistoryError(false)
    try {
      const res = await api.hqSupport.list()
      if (!res.success) throw new Error(res.error)
      setHistory(res.data)
    } catch {
      setHistory([])
      setHistoryError(true)
    }
  }

  const set = <K extends keyof HqSupportInput>(key: K, next: HqSupportInput[K]) => {
    setSent(null)
    setInput((v) => ({ ...v, [key]: next }))
  }

  const addFile = async (file: File | undefined) => {
    if (!file) return
    const reason = validateSupportAttachment(file, attachments.length)
    if (reason) {
      setError(reason)
      return
    }
    setError('')
    try {
      const data = await readFileAsBase64(file)
      setAttachments((prev) => [...prev, { name: file.name, mimeType: file.type, data, size: file.size, previewUrl: URL.createObjectURL(file) }])
    } catch {
      setError('画像を読み取れませんでした')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const removeAttachment = (index: number) => {
    setAttachments((prev) => {
      const target = prev[index]
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((_, i) => i !== index)
    })
  }

  const blocked = useMemo(() => validateSupportInput(input), [input])

  const send = async () => {
    if (blocked || sending) return
    setSending(true)
    setError('')
    try {
      const res = await api.hqSupport.create({
        kind: input.kind as HqSupportKind,
        subject: input.subject.trim(),
        body: input.body.trim(),
        lineAccountId: input.lineAccountId || null,
        attachments: attachments.map((a) => ({ mimeType: a.mimeType, data: a.data })),
      })
      if (!res.success) throw new Error(res.error)
      setSent(res.data)
      setInput(EMPTY_SUPPORT_INPUT)
      attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl))
      setAttachments([])
      void loadHistory()
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : '送信できませんでした。もう一度お試しください。')
    } finally {
      setSending(false)
    }
  }

  const clear = () => {
    setInput(EMPTY_SUPPORT_INPUT)
    attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl))
    setAttachments([])
    setError('')
    setSent(null)
  }

  return (
    <div data-design-node="X6LZP" className="flex flex-col gap-4">
      <div data-design-node="kcTeV">
        <NoteBar tone="info">
          使い方の質問、不具合、料金の相談はここから送れます。返信は登録メールアドレスに届きます（平日 2営業日以内）。
        </NoteBar>
      </div>

      {sent ? (
        <div className="rounded-card bg-accent-soft px-4 py-3 text-label text-ink" role="status">
          お問い合わせを送りました。
          {sent.notified ? '控えが登録メールアドレスにも届きます。' : '控えメールは送れませんでしたが、内容は運営に届いています。'}
        </div>
      ) : null}

      <div data-design-node="VKxoO" className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <form
          data-design-node="hAh52"
          className="flex min-w-0 flex-1 flex-col gap-4 rounded-card border border-hairline bg-canvas p-5"
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <h2 className="text-body font-bold text-ink">問い合わせ内容</h2>

          <Field label="種類" required htmlFor={`${uid}-kind`}>
            <SelectField
              id={`${uid}-kind`}
              className="w-full"
              style={{ width: '100%' }}
              value={input.kind}
              disabled={sending}
              onChange={(e) => set('kind', e.target.value as HqSupportKind | '')}
              options={[{ value: '', label: '種類を選んでください' }, ...kinds.map((k) => ({ value: k.key, label: k.label }))]}
            />
          </Field>

          <Field label="件名" required htmlFor={`${uid}-subject`}>
            <TextField
              id={`${uid}-subject`}
              value={input.subject}
              maxLength={SUPPORT_SUBJECT_MAX}
              disabled={sending}
              placeholder="例: バナー生成で日本語の文字が崩れることがある"
              onChange={(e) => set('subject', e.target.value)}
              className="w-full"
            />
          </Field>

          <Field label="本文" required note="困っていること・期待する動き・起きた日時" htmlFor={`${uid}-body`}>
            <TextArea
              id={`${uid}-body`}
              rows={8}
              value={input.body}
              maxLength={SUPPORT_BODY_MAX}
              disabled={sending}
              placeholder="例: 「2周年 春の感謝祭」と入れて生成すると、2枚に1枚は「感謝際」のように誤字になります。再現するプロジェクト名は「春の感謝祭 2周年」です。"
              onChange={(e) => set('body', e.target.value)}
              className="w-full"
            />
          </Field>

          <Field label="関係する店舗" note="任意" htmlFor={`${uid}-account`}>
            <SelectField
              id={`${uid}-account`}
              className="w-full"
              style={{ width: '100%' }}
              value={input.lineAccountId}
              disabled={sending}
              onChange={(e) => set('lineAccountId', e.target.value)}
              options={[{ value: '', label: '指定しない' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
            />
          </Field>

          <div className="flex flex-col gap-1.5">
            <span className="text-label font-bold text-ink">画面の画像（任意・{SUPPORT_ATTACHMENT_MAX}枚まで）</span>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => void addFile(event.target.files?.[0])}
            />
            {attachments.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {attachments.map((a, i) => (
                  <li key={`${a.name}-${i}`} className="relative overflow-hidden rounded-control border border-hairline bg-shell">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.previewUrl} alt={a.name} className="h-20 w-28 object-cover" />
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      aria-label={`${a.name} を外す`}
                      className="absolute top-1 right-1 rounded-mini bg-canvas/80 p-0.5 text-ink-secondary"
                    >
                      <X aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {attachments.length < SUPPORT_ATTACHMENT_MAX ? (
              <button
                type="button"
                disabled={sending}
                onClick={() => fileRef.current?.click()}
                className="flex h-18 w-full items-center justify-center gap-2 rounded-control bg-surface-pearl text-caption text-ink-faint hover:bg-canvas-sunken disabled:opacity-50"
              >
                <ImagePlus aria-hidden="true" className="h-4.5 w-4.5" />
                クリックして画像を選ぶ（PNG・JPEG、1枚 5MB まで）
              </button>
            ) : null}
          </div>

          {error ? <p className="text-label text-status-danger" role="alert">{error}</p> : null}
        </form>

        <div className="flex w-full shrink-0 flex-col gap-4 xl:w-auto" style={{ maxWidth: 390 }}>
          <section data-design-node="a1kbdf" className="flex flex-col gap-2.5 rounded-card border border-hairline bg-canvas p-4">
            <h2 className="text-body font-bold text-ink">送信者</h2>
            <dl className="flex flex-col gap-2">
              <Row label="統括" value={tenantName || '—'} />
              <Row label="名前" value={me?.name ?? '—'} />
              <Row label="メール" value={me?.email ?? '—'} />
            </dl>
            <p className="text-micro text-ink-faint">この内容が問い合わせに添えられます。返信はこのメールアドレスに届きます。</p>
          </section>

          <section data-design-node="Srh5W" className="flex flex-col rounded-card border border-hairline bg-canvas">
            <h2 className="px-4 py-3 text-body font-bold text-ink">これまでの問い合わせ</h2>
            <div className="border-t border-hairline" />
            {history === null ? (
              <p className="px-4 py-4 text-caption text-ink-faint">読み込んでいます…</p>
            ) : historyError ? (
              <p className="px-4 py-4 text-caption text-status-danger">読み込めませんでした。</p>
            ) : history.length === 0 ? (
              <p className="px-4 py-4 text-caption text-ink-faint">まだ問い合わせはありません。</p>
            ) : (
              <ul className="flex flex-col">
                {history.slice(0, 10).map((item) => (
                  <li key={item.id} className="flex flex-col gap-1 border-b border-divider-soft px-4 py-3 last:border-b-0">
                    <p className="truncate text-label font-semibold text-ink">{item.subject}</p>
                    <p className="flex items-center gap-2 text-micro text-ink-faint">
                      {shortDateTime(item.createdAt)}
                      <span className="text-ink-faint">・{item.kindLabel}</span>
                      <span
                        className={
                          item.status === 'open'
                            ? 'inline-flex h-4.5 items-center rounded-pill bg-status-info-soft px-2 text-nano font-bold text-status-info'
                            : 'inline-flex h-4.5 items-center rounded-pill bg-accent-soft px-2 text-nano font-bold text-accent-deep'
                        }
                      >
                        {SUPPORT_STATUS_LABELS[item.status]}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <div data-design-node="kgFxH" className="sticky bottom-0 z-10">
        <StickyBar
          status={blocked && (input.subject || input.body || input.kind) ? <span className="text-status-warn-deep">{blocked}</span> : '送信すると、控えが登録メールアドレスにも届きます'}
          actions={
            <>
              <Button onClick={clear} disabled={sending}>内容をクリア</Button>
              <Button variant="primary" onClick={() => void send()} disabled={sending || Boolean(blocked)}>
                <Send aria-hidden="true" className="h-4 w-4" />
                {sending ? '送信中…' : '送信する'}
              </Button>
            </>
          }
        />
      </div>
    </div>
  )
}

function Field({ label, required, note, htmlFor, children }: { label: string; required?: boolean; note?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <label htmlFor={htmlFor} className="text-label font-bold text-ink">{label}</label>
        {required ? <span className="inline-flex h-4.5 items-center rounded-mini bg-status-danger-soft px-1.5 text-nano font-bold text-status-danger">必須</span> : null}
        {note ? <span className="text-micro text-ink-faint">{note}</span> : null}
      </div>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-16 shrink-0 text-caption font-semibold text-ink-faint">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-label text-ink">{value}</dd>
    </div>
  )
}
