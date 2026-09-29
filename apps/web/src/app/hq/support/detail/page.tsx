'use client'

import { ChevronLeft, ImagePlus, Paperclip, Send, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { StaffMember } from '@line-crm/shared'
import Button from '@/components/shared/button'
import NoteBar from '@/components/shared/note-bar'
import StickyBar from '@/components/shared/sticky-bar'
import TargetMissing from '@/components/shared/target-missing'
import { TextArea } from '@/components/shared/text-field'
import { usePageTitle } from '@/components/shell/page-chrome'
import { api, ApiError } from '@/lib/api'
import { readFileAsBase64, shortDateTime } from '@/lib/hq-banners'
import {
  SUPPORT_ATTACHMENT_MAX,
  SUPPORT_BODY_MAX,
  SUPPORT_STATUS_LABELS,
  validateSupportAttachment,
  type HqSupportDetail,
  type HqSupportRequest,
} from '@/lib/hq-support'

type Attachment = { name: string; mimeType: string; data: string; size: number; previewUrl: string }

/**
 * お問い合わせの続きを送る。★V6 36-3-A（`Nt0UH`）。
 *
 * 36-3 の「これまでの問い合わせ」から開く。左にやり取り（統括は左・運営は右）と「続きを送る」欄、
 * 右に送信者と一覧。送ると運営のチケットは対応中へ戻り、運営へ通知、控えが登録メールへ届く。
 * 静的書き出しのため動的セグメントは使わず `?id=` で受ける。
 */
export default function HqSupportDetailPage() {
  usePageTitle('お問い合わせ')
  const router = useRouter()
  const uid = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  /*
   * U099: `id` を3値で持つ。`undefined` はまだURLを読んでいない、
   * `null` はURLにidが無い。前は両方 `null` だったので、id無しの
   * 画面が「読み込んでいます…」のまま永遠に進まなかった。
   */
  const [id, setId] = useState<string | null | undefined>(undefined)
  const [detail, setDetail] = useState<HqSupportDetail | null>(null)
  const [loadError, setLoadError] = useState('')
  /** 404・空で見つからないとき。取得の失敗（loadError）とは分ける。 */
  const [detailMissing, setDetailMissing] = useState(false)
  const [detailLoading, setDetailLoading] = useState(true)
  const [me, setMe] = useState<StaffMember | null>(null)
  const [tenantName, setTenantName] = useState('')
  const [history, setHistory] = useState<HqSupportRequest[] | null>(null)
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get('id'))
  }, [])

  // U099: id が無いことが確定したら、取得には行かず案内へ進む。
  const idMissing = id === null

  const load = useCallback(async (requestId: string) => {
    setLoadError('')
    setDetailMissing(false)
    setDetailLoading(true)
    try {
      const res = await api.hqSupport.detail(requestId)
      if (!res.success) { setLoadError(res.error || '読み込めませんでした'); return }
      setDetail(res.data)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        setDetailMissing(true)
      } else {
        setLoadError('読み込めませんでした')
      }
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (id === undefined) return
    if (id) void load(id)
    /*
      送信者と履歴は id が無くても読む。U099: id 無しで開いた人も、
      右の「これまでの問い合わせ」から正しい件へ戻れるようにする。
    */
    void Promise.allSettled([api.staff.me(), api.tenants.me(), api.hqSupport.list()]).then(([meRes, tenantRes, listRes]) => {
      if (meRes.status === 'fulfilled' && meRes.value.success) setMe(meRes.value.data)
      if (tenantRes.status === 'fulfilled' && tenantRes.value.success) setTenantName(tenantRes.value.data.name)
      if (listRes.status === 'fulfilled' && listRes.value.success) setHistory(listRes.value.data)
    })
  }, [id, load])

  const addFile = async (file: File | undefined) => {
    if (!file) return
    const reason = validateSupportAttachment(file, attachments.length)
    if (reason) { setError(reason); return }
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

  const blocked = !body.trim() ? '本文を入力してください' : body.length > SUPPORT_BODY_MAX ? `本文は${SUPPORT_BODY_MAX}文字以内で入力してください` : ''

  const send = async () => {
    if (!id || blocked || sending) return
    setSending(true)
    setError('')
    setNotice('')
    try {
      const res = await api.hqSupport.followUp(id, { body: body.trim(), attachments: attachments.map((a) => ({ mimeType: a.mimeType, data: a.data })) })
      if (!res.success) throw new Error(res.error)
      setBody('')
      attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl))
      setAttachments([])
      setNotice('続きを送りました。運営に届き、控えが登録メールアドレスにも届きます。')
      await load(id)
    } catch (caught) {
      setError(caught instanceof Error && caught.message && !caught.message.startsWith('API error:') ? caught.message : '送信できませんでした。もう一度お試しください。')
    } finally {
      setSending(false)
    }
  }

  const statusChip = (status: HqSupportRequest['status']) => (
    <span className={status === 'open'
      ? 'inline-flex h-4.5 items-center rounded-pill bg-status-info-soft px-2 text-nano font-bold text-status-info'
      : 'inline-flex h-4.5 items-center rounded-pill bg-accent-soft px-2 text-nano font-bold text-accent-deep'}>
      {SUPPORT_STATUS_LABELS[status]}
    </span>
  )

  return (
    <div data-design-node="Nt0UH" className="flex flex-col gap-4">
      <div data-design-node="kcTeV">
        <NoteBar tone="info">運営からの返信はここと登録メールアドレスに届きます。追加で伝えたいことは、下の欄から同じ件の続きとして送れます。</NoteBar>
      </div>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <section data-design-node="h0DgNn" className="flex min-w-0 flex-1 flex-col gap-4 rounded-card border border-hairline bg-canvas p-5">
          {idMissing ? (
            <TargetMissing
              kind="unspecified"
              title="開くお問い合わせが指定されていません"
              description="一覧から開くお問い合わせを選び直してください。"
              backHref="/hq/support"
              backLabel="問い合わせの一覧へ戻る"
            />
          ) : detailLoading || id === undefined ? (
            <p className="text-caption text-ink-faint">読み込んでいます…</p>
          ) : detailMissing || (!loadError && !detail) ? (
            <TargetMissing
              kind="not-found"
              title="このお問い合わせは見つかりません"
              description="削除されたか、別の記録です。一覧から選び直してください。"
              backHref="/hq/support"
              backLabel="問い合わせの一覧へ戻る"
            />
          ) : loadError || !detail ? (
            <TargetMissing
              kind="error"
              title="お問い合わせを読み込めませんでした"
              description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
              onRetry={() => { if (id) void load(id) }}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-label font-bold text-ink-secondary">{detail.ticketLabel}</span>
                <h2 className="text-body font-bold text-ink">{detail.subject}</h2>
                {statusChip(detail.status)}
                <span className="text-micro text-ink-faint">{shortDateTime(detail.createdAt)} に送信・{detail.kindLabel}</span>
              </div>

              <ol className="flex flex-col gap-3" aria-label="やり取り">
                <Message side="left" author={`${tenantName || '統括'} ／ ${detail.staffName || '—'}`} at={detail.createdAt} body={detail.body} attachments={detail.attachments} />
                {(detail.messages ?? []).map((m) => (
                  <Message
                    key={m.id}
                    side={m.authorKind === 'ops' ? 'right' : 'left'}
                    author={m.authorKind === 'ops' ? m.authorName : `${tenantName || '統括'} ／ ${m.authorName}`}
                    at={m.createdAt}
                    body={m.body}
                    attachments={m.attachments}
                  />
                ))}
              </ol>

              <div className="flex flex-col gap-1.5 border-t border-hairline pt-4">
                <div className="flex items-center gap-2">
                  <label htmlFor={`${uid}-body`} className="text-label font-bold text-ink">続きを送る</label>
                  <span className="text-micro text-ink-faint">運営の返信への返事や、追加で分かったこと</span>
                </div>
                <TextArea
                  id={`${uid}-body`}
                  rows={5}
                  value={body}
                  onChange={(event) => { setBody(event.target.value); setNotice('') }}
                  placeholder="例：「文字を画像に焼き込む」で崩れなくなりました。生成側の修正が終わったら教えてください。"
                  maxLength={SUPPORT_BODY_MAX}
                  disabled={sending}
                />
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
                        <button type="button" onClick={() => removeAttachment(i)} aria-label={`${a.name} を外す`} className="absolute top-1 right-1 rounded-mini bg-canvas/80 p-0.5 text-ink-secondary">
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
                    className="flex items-center gap-2 text-micro text-ink-faint hover:text-ink-secondary disabled:opacity-50"
                  >
                    <ImagePlus aria-hidden="true" className="h-4 w-4" />
                    画像を添えるときは、クリックして選びます（PNG・JPEG、5MBまで、{SUPPORT_ATTACHMENT_MAX}枚まで）
                  </button>
                ) : null}
                {notice ? <p className="text-label text-accent-deep" role="status">{notice}</p> : null}
                {error ? <p className="text-label text-danger" role="alert">{error}</p> : null}
              </div>
            </>
          )}
        </section>

        <div className="flex w-full shrink-0 flex-col gap-4 xl:w-auto" style={{ maxWidth: 390 }}>
          <section data-design-node="a1kbdf" className="flex flex-col gap-2.5 rounded-card border border-hairline bg-canvas p-4">
            <h2 className="text-body font-bold text-ink">送信者</h2>
            <dl className="flex flex-col gap-2">
              <Row label="統括" value={tenantName || '—'} />
              <Row label="名前" value={me?.name ?? '—'} />
              <Row label="メール" value={me?.email ?? '—'} />
            </dl>
            <p className="text-micro text-ink-faint">この内容が続きに添えられます。返信はこのメールアドレスに届きます。</p>
          </section>

          <section data-design-node="jeBCt" className="flex flex-col rounded-card border border-hairline bg-canvas">
            <h2 className="px-4 py-3 text-body font-bold text-ink">これまでの問い合わせ</h2>
            <div className="border-t border-hairline" />
            {history === null ? (
              <p className="px-4 py-4 text-caption text-ink-faint">読み込んでいます…</p>
            ) : !Array.isArray(history) ? (
              <p className="px-4 py-4 text-caption text-ink-faint">これまでの問い合わせを読み込めませんでした。</p>
            ) : history.length === 0 ? (
              <p className="px-4 py-4 text-caption text-ink-faint">まだ問い合わせはありません。</p>
            ) : (
              <ul className="flex flex-col">
                {history.slice(0, 10).map((item) => (
                  <li key={item.id} className={`border-b border-divider-soft last:border-b-0 ${item.id === id ? 'bg-accent-soft' : ''}`}>
                    <Link href={`/hq/support/detail?id=${encodeURIComponent(item.id)}`} aria-current={item.id === id ? 'page' : undefined} className="flex flex-col gap-1 px-4 py-3 hover:bg-canvas-sunken">
                      <span className="truncate text-label font-semibold text-ink">{item.subject}</span>
                      <span className="flex items-center gap-2 text-micro text-ink-faint">
                        {shortDateTime(item.createdAt)}
                        {statusChip(item.status)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <div data-design-node="kgFxH" className="sticky bottom-0 z-10">
        <StickyBar
          status={blocked && body ? <span className="text-status-warn-deep">{blocked}</span> : '送信すると運営に届き、控えが登録メールアドレスにも届きます'}
          actions={
            <>
              <Button onClick={() => router.push('/hq/support')} disabled={sending}>
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                一覧へ戻る
              </Button>
              <Button variant="primary" onClick={() => void send()} disabled={sending || Boolean(blocked) || !detail}>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-label">
      <dt className="w-18 shrink-0 text-ink-faint">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-ink">{value}</dd>
    </div>
  )
}

function Message({ side, author, at, body, attachments }: { side: 'left' | 'right'; author: string; at: string; body: string; attachments?: Array<{ key: string; url: string }> }) {
  const files = attachments ?? []
  return (
    <li className={`flex max-w-3xl flex-col gap-1 ${side === 'right' ? 'items-end self-end' : 'items-start'}`}>
      <span className="flex items-baseline gap-2 text-micro text-ink-secondary">
        <span className="font-bold">{author}</span>
        <span className="text-ink-faint">{shortDateTime(at)}</span>
      </span>
      <p className={`whitespace-pre-wrap rounded-control px-3.5 py-3 text-left text-label text-ink ${side === 'right' ? 'bg-accent-soft' : 'bg-surface-pearl'}`}>{body}</p>
      {files.length > 0 ? (
        <span className="flex flex-wrap gap-2">
          {files.map((a) => (
            <a key={a.key} href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-micro text-action underline-offset-2 hover:underline">
              <Paperclip aria-hidden="true" className="h-3.5 w-3.5" />
              {(a.key ?? '').split('/').pop()}
            </a>
          ))}
        </span>
      ) : null}
    </li>
  )
}
