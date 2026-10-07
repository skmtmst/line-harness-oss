'use client'

/*
 * ★V8 お問い合わせのやり取り（Pencil `OhguS`）。
 *
 * v7 の画面（app/hq/support/detail/page.tsx）と読み書きの口・失敗時の扱いは同じ。
 * 見た目だけを絵どおりに一から組んだ：頭（題＝件名・説明＝受付番号・種類・店舗・送った日時）・
 * 左の「統括の設定」の列・状態の札・やり取りのカード（自分は右の緑、運営は左の灰）・
 * 続きを送るカード・右に送信者とこれまでの問い合わせ。
 * 静的書き出しのため動的セグメントは使わず `?id=` で受ける（v7 と同じ）。
 */
import { ImagePlus, Paperclip, Send, X } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { StaffMember } from '@line-crm/shared'
import { ListPage } from '@/components/templates'
import Button from '@/components/shared/button'
import TargetMissing from '@/components/shared/target-missing'
import { TextArea } from '@/components/shared/text-field'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { api, ApiError } from '@/lib/api'
import { readFileAsBase64 } from '@/lib/hq-banners'
import {
  SUPPORT_ATTACHMENT_MAX,
  SUPPORT_BODY_MAX,
  validateSupportAttachment,
  type HqSupportDetail,
  type HqSupportRequest,
} from '@/lib/hq-support'
import HqSettingsNavV8, { useHqSettingsFolderNav } from './settings-nav'
import { SUPPORT_STATUS_WORDS, supportTime } from './support-words'
import styles from './support-detail.module.css'

type Attachment = { name: string; mimeType: string; data: string; size: number; previewUrl: string }

/** 状態の札の横の一言（メールが無い人にメール到着を言わない：R609）。 */
function statusNote(status: HqSupportRequest['status'], hasEmail: boolean): string {
  if (status === 'open') return hasEmail ? '運営が確認しています。返事は登録メールにも届きます' : '運営が確認しています。返事はこの画面に届きます'
  if (status === 'answered') return hasEmail ? '運営から返事が届いています。登録メールにも同じ内容が届きます' : '運営から返事が届いています'
  return '解決済みです。続きを送ると、運営がもう一度確認します'
}

/** 送るボタンの横の一言（v7 の supportSendStatus を短くした絵の言葉）。 */
const SEND_NOTE = '送ると運営の対応は「対応中」に戻ります'

function sentNotice(hasEmail: boolean): string {
  return hasEmail
    ? '続きを送りました。運営に届き、控えが登録メールアドレスにも届きます。'
    : '続きを送りました。運営に届きました。返信はこの画面のやり取りに届きます。'
}

export default function HqSupportDetailV8() {
  const settingsNav = useHqSettingsFolderNav('contact')
  const uid = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  /* U099: `undefined` はまだ URL を読んでいない、`null` は URL に id が無い。 */
  const [id, setId] = useState<string | null | undefined>(undefined)
  const [detail, setDetail] = useState<HqSupportDetail | null>(null)
  const [loadError, setLoadError] = useState('')
  const [detailMissing, setDetailMissing] = useState(false)
  const [detailLoading, setDetailLoading] = useState(true)
  const [me, setMe] = useState<StaffMember | null>(null)
  const [tenantName, setTenantName] = useState('')
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([])
  const [history, setHistory] = useState<HqSupportRequest[] | null>(null)
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get('id'))
  }, [])

  const idMissing = id === null
  const hasSenderEmail = (me?.email ?? '').trim().length > 0

  const load = useCallback(async (requestId: string) => {
    setLoadError('')
    setDetailMissing(false)
    setDetailLoading(true)
    try {
      const res = await api.hqSupport.detail(requestId)
      if (!res.success) { setLoadError(res.error || '読み込めませんでした'); return }
      setDetail(res.data)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) setDetailMissing(true)
      else setLoadError('読み込めませんでした')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (id === undefined) return
    if (id) void load(id)
    // 送信者と履歴は id が無くても読む（U099：右の一覧から正しい件へ戻れるように）。
    void Promise.allSettled([api.staff.me(), api.tenants.me(), api.hqSupport.list(), api.hqSupport.context()]).then(([meRes, tenantRes, listRes, contextRes]) => {
      if (meRes.status === 'fulfilled' && meRes.value.success) setMe(meRes.value.data)
      if (tenantRes.status === 'fulfilled' && tenantRes.value.success) setTenantName(tenantRes.value.data.name)
      if (listRes.status === 'fulfilled' && listRes.value.success) setHistory(listRes.value.data)
      if (contextRes.status === 'fulfilled' && contextRes.value.success && Array.isArray(contextRes.value.data?.accounts)) setAccounts(contextRes.value.data.accounts)
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
      setNotice(sentNotice(hasSenderEmail))
      await load(id)
    } catch (caught) {
      setError(caught instanceof Error && caught.message && !caught.message.startsWith('API error:') ? caught.message : '送信できませんでした。もう一度お試しください。')
    } finally {
      setSending(false)
    }
  }

  const ready = !idMissing && !detailLoading && id !== undefined && !detailMissing && !loadError && detail
  const accountName = detail?.lineAccountId ? accounts.find((a) => a.id === detail.lineAccountId)?.name ?? null : null
  const title = ready ? detail.subject : 'お問い合わせのやり取り'
  // ★V8 パンくずは「ホーム › 統括の設定 › お問い合わせ › 番号」（絵 `V8-B/OhguS`）。番号が無い・読み込み中は「お問い合わせ」。
  const ticketLabel = ready ? detail.ticketLabel ?? '' : ''
  usePageTitle(ticketLabel || 'お問い合わせ')
  usePageCrumbs(ticketLabel ? [{ label: '統括の設定', href: '/hq/settings' }, { label: 'お問い合わせ', href: '/hq/support' }] : [{ label: '統括の設定', href: '/hq/settings' }])
  const description = ready
    ? [detail.ticketLabel, detail.kindLabel, accountName, `${supportTime(detail.createdAt)} に送信`].filter(Boolean).join(' ・ ')
    : '問い合わせの内容と運営からの返事を確認します。'

  return (
    <ListPage boardId="OhguS" title={title} description={description} folders={<HqSettingsNavV8 active="contact" />} folderNav={settingsNav}>
      <div className={styles.body}>
        <div className={styles.main}>
          {idMissing ? (
            <TargetMissing kind="unspecified" title="開くお問い合わせが指定されていません" description="一覧から開くお問い合わせを選び直してください。" backHref="/hq/support" backLabel="問い合わせの一覧へ戻る" />
          ) : detailLoading || id === undefined ? (
            <p className={styles.faint}>読み込んでいます…</p>
          ) : detailMissing || (!loadError && !detail) ? (
            <TargetMissing kind="not-found" title="このお問い合わせは見つかりません" description="削除されたか、別の記録です。一覧から選び直してください。" backHref="/hq/support" backLabel="問い合わせの一覧へ戻る" />
          ) : loadError || !detail ? (
            <TargetMissing kind="error" title="お問い合わせを読み込めませんでした" description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。" onRetry={() => { if (id) void load(id) }} />
          ) : (
            <>
              <div className={styles.statusRow}>
                <span className={detail.status === 'open' ? `${styles.pill} ${styles.pillInfo}` : `${styles.pill} ${styles.pillOk}`}><span className={styles.dot} aria-hidden="true" />{SUPPORT_STATUS_WORDS[detail.status]}</span>
                <span className={styles.statusNote}>{statusNote(detail.status, hasSenderEmail)}</span>
              </div>

              <ol className={styles.thread} aria-label="やり取り">
                <Message mine author={detail.staffName || tenantName || '統括'} at={detail.createdAt} body={detail.body} attachments={detail.attachments} />
                {(detail.messages ?? []).map((m) => (
                  <Message key={m.id} mine={m.authorKind !== 'ops'} author={m.authorName} at={m.createdAt} body={m.body} attachments={m.attachments} />
                ))}
              </ol>

              <div className={styles.compose}>
                <label htmlFor={`${uid}-body`} className={styles.composeTitle}>続きを送る</label>
                <TextArea
                  id={`${uid}-body`}
                  value={body}
                  onChange={(event) => { setBody(event.target.value); setNotice('') }}
                  placeholder="運営の返信への返事や、追加で分かったこと"
                  maxLength={SUPPORT_BODY_MAX}
                  disabled={sending}
                  className={styles.textarea}
                />
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  className={styles.hiddenInput}
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => void addFile(event.target.files?.[0])}
                />
                {attachments.length > 0 ? (
                  <ul className={styles.thumbs}>
                    {attachments.map((a, i) => (
                      <li key={`${a.name}-${i}`} className={styles.thumb}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.previewUrl} alt={a.name} className={styles.thumbImage} />
                        <button type="button" onClick={() => removeAttachment(i)} aria-label={`${a.name} を外す`} className={styles.thumbRemove}>
                          <X aria-hidden="true" className={styles.smallIcon} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className={styles.composeRow}>
                  {attachments.length < SUPPORT_ATTACHMENT_MAX ? (
                    <Button onClick={() => fileRef.current?.click()} disabled={sending} title={`PNG・JPEG、5MBまで、${SUPPORT_ATTACHMENT_MAX}枚まで`}>
                      <ImagePlus aria-hidden="true" className={styles.buttonIcon} />画像を添える
                    </Button>
                  ) : null}
                  <span className={styles.spacer} />
                  <span className={styles.sendNote}>{blocked && body ? <span className={styles.warn}>{blocked}</span> : SEND_NOTE}</span>
                  <Button variant="primary" onClick={() => void send()} disabled={sending || Boolean(blocked) || !detail} busy={sending} busyLabel="送信中…">
                    <Send aria-hidden="true" className={styles.buttonIcon} />送る
                  </Button>
                </div>
                {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
                {error ? <p className={styles.error} role="alert">{error}</p> : null}
              </div>
            </>
          )}
        </div>

        <aside className={styles.side}>
          <section className={styles.sender} aria-label="送信者">
            <h2 className={styles.senderTitle}>送信者</h2>
            <p className={styles.senderLines} title={hasSenderEmail ? 'この内容が続きに添えられます。返信はこのメールアドレスに届きます。' : 'この内容が続きに添えられます。返信はこの画面のやり取りに届きます。'}>
              {`名前：${me?.name ?? '—'}`}<br />
              {`メール：${me?.email ?? '—'}`}<br />
              {`統括：${tenantName || '—'}`}
            </p>
          </section>

          <section className={styles.history} aria-label="これまでの問い合わせ">
            <h2 className={styles.historyTitle}>これまでの問い合わせ</h2>
            {history === null ? (
              <p className={styles.historyEmpty}>読み込んでいます…</p>
            ) : !Array.isArray(history) ? (
              <p className={styles.historyEmpty}>これまでの問い合わせを読み込めませんでした。</p>
            ) : history.length === 0 ? (
              <p className={styles.historyEmpty}>まだ問い合わせはありません。</p>
            ) : (
              <ul className={styles.historyList}>
                {history.slice(0, 10).map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/hq/support/detail?id=${encodeURIComponent(item.id)}`}
                      aria-current={item.id === id ? 'page' : undefined}
                      className={item.id === id ? `${styles.historyRow} ${styles.historyRowCurrent}` : styles.historyRow}
                    >
                      <span className={styles.historyName} title={item.subject}>{[item.ticketLabel, item.subject].filter(Boolean).join(' ')}</span>
                      <span className={item.status === 'open' ? `${styles.pill} ${styles.pillInfo}` : `${styles.pill} ${styles.pillOk}`}><span className={styles.dot} aria-hidden="true" />{SUPPORT_STATUS_WORDS[item.status]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </ListPage>
  )
}

function Message({ mine, author, at, body, attachments }: { mine: boolean; author: string; at: string; body: string; attachments?: Array<{ key: string; url: string }> }) {
  const files = attachments ?? []
  return (
    <li className={mine ? `${styles.message} ${styles.messageMine}` : styles.message}>
      <span className={styles.author}>{`${author} ・ ${supportTime(at)}`}</span>
      <p className={mine ? `${styles.bubble} ${styles.bubbleMine}` : styles.bubble}>{body}</p>
      {files.length > 0 ? (
        <span className={styles.files}>
          {files.map((a) => (
            <a key={a.key} href={a.url} target="_blank" rel="noreferrer" className={styles.file}>
              <Paperclip aria-hidden="true" className={styles.smallIcon} />
              {(a.key ?? '').split('/').pop()}
            </a>
          ))}
        </span>
      ) : null}
    </li>
  )
}
