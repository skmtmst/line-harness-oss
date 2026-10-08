'use client'

/*
 * ★V8 統括のお問い合わせ（Pencil `b8xBtZ`。運営の LINE を登録する窓を開いた状態が `D6fh3`）。
 *
 * v7 の画面（app/hq/support/page.tsx）と読み書きの口・権限・失敗時の扱いは同じ。
 * 見た目だけを絵どおりに一から組んだ：頭（型 ListPage）・左の「統括の設定」の列
 * （型のフォルダの列）・問い合わせのカード・これまでの問い合わせの表。
 */
import StatusPill from '@/components/shared/status-pill'
import { CheckCircle2, ImagePlus, Plus, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ListPage } from '@/components/templates'
import Button from '@/components/shared/button'
import { describeApiFailure, japaneseDetailOf } from '@/components/shared/api-error-message'
import Dialog from '@/components/shared/dialog'
import Select from '@/components/shared/select'
import { TextArea, TextField } from '@/components/shared/text-field'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useTenantStatus } from '@/components/tenant-access-context'
import { api } from '@/lib/api'
import { readFileAsBase64 } from '@/lib/hq-banners'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import {
  EMPTY_SUPPORT_INPUT,
  SUPPORT_ATTACHMENT_MAX,
  SUPPORT_BODY_MAX,
  SUPPORT_SUBJECT_MAX,
  validateSupportAttachment,
  validateSupportInput,
  type HqSupportContext,
  type HqSupportInput,
  type HqSupportKind,
  type HqSupportRequest,
} from '@/lib/hq-support'
import HqSettingsNavV8, { useHqSettingsFolderNav } from './settings-nav'
import NoticeLineDialogV8 from './notice-line-dialog'
import { SUPPORT_STATUS_WORDS, supportKindWord, supportTime } from './support-words'
import styles from './support.module.css'

type Attachment = { name: string; mimeType: string; data: string; size: number; previewUrl: string }

export default function HqSupportV8() {
  // ★V8 上の帯のパンくずは「ホーム › 統括の設定 › 画面名」（絵 `V8-B/b8xBtZ`）。
  usePageTitle('お問い合わせ')
  const settingsNav = useHqSettingsFolderNav('contact')
  usePageCrumbs([{ label: '統括の設定', href: '/hq/settings' }])
  const tenantStatus = useTenantStatus()
  const tenantUnavailable = tenantStatus === 'suspended' || tenantStatus === 'archived'
  const uid = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [kinds, setKinds] = useState<Array<{ key: HqSupportKind; label: string }>>([])
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([])
  const [sender, setSender] = useState({ tenantName: '', name: '', email: null as string | null, planLabel: '—' })
  const [history, setHistory] = useState<HqSupportRequest[] | null>(null)
  const [historyError, setHistoryError] = useState(false)
  const [input, setInput] = useState<HqSupportInput>(EMPTY_SUPPORT_INPUT)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState<HqSupportRequest | null>(null)
  const [lineGuide, setLineGuide] = useState(false)

  const loadHistory = async () => {
    setHistoryError(false)
    try {
      const res = await api.hqSupport.list()
      if (!res.success) throw new Error(res.error)
      if (!Array.isArray(res.data)) throw new Error('unexpected history shape')
      setHistory(res.data)
    } catch {
      setHistory([])
      setHistoryError(true)
    }
  }

  useEffect(() => {
    let cancelled = false
    void api.hqSupport.context().then((res) => {
      if (cancelled || !res.success) return
      // 形が違っても入力欄は出す（偽APIの既定の器で `kinds.map` が落ちた 2026-09-25 の守り）。
      const data = res.data as Partial<HqSupportContext> | undefined
      setKinds(Array.isArray(data?.kinds) ? data.kinds : [])
      setAccounts(Array.isArray(data?.accounts) ? data.accounts : [])
      if (data?.sender) {
        setSender({
          tenantName: data.sender.tenantName ?? '',
          name: data.sender.name ?? '',
          email: data.sender.email ?? null,
          planLabel: data.sender.planLabel ?? '—',
        })
      }
    }).catch(() => {
      // 履歴と送信は独立して使える。表示用情報だけ空のままにする。
    })
    void loadHistory()
    return () => {
      cancelled = true
    }
  }, [])

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
      // M027：原文のまま出さず、共通の状態別案内へ渡す。
      setError(japaneseDetailOf(caught) || describeApiFailure(caught, '送信', {
        forbidden: 'お問い合わせの送信はオーナー・管理者・担当者だけができます。',
      }))
      // 確定応答を失った再送でも履歴で確かめられるよう、履歴を読み直す（重複は口側 M028 が防ぐ）。
      void loadHistory()
    } finally {
      setSending(false)
    }
  }

  /*
   * 書きかけの件名・内容・添えた画像は送るまで画面にしか無い。左の列やメニューで離れると
   * 消えるので、離れる前に確かめる。送る・消すで空になると外れる（種類・アカウントの選択だけでは出さない）。
   */
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({
    dirty: input.subject.trim() !== '' || input.body.trim() !== '' || attachments.length > 0,
    busy: sending,
  })

  const clear = () => {
    setInput(EMPTY_SUPPORT_INPUT)
    attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl))
    setAttachments([])
    setError('')
    setSent(null)
  }

  return (
    <ListPage
      boardId="b8xBtZ"
      title="お問い合わせ"
      description="使い方の質問・不具合・料金の相談を運営へ送れます。返信は登録メールアドレスと、下の「これまでの問い合わせ」に届きます（平日 2 営業日以内）。"
      folders={<HqSettingsNavV8 active="contact" />} folderNav={settingsNav}
    >
      <div className={styles.body}>
        {/* 契約者専用LINEの登録案内（2026-09-18 決定：ここからもいつでも開ける。開いた状態が板 D6fh3） */}
        {!tenantUnavailable ? <NoticeLineDialogV8 open={lineGuide} onClose={() => setLineGuide(false)} /> : null}

        <UnsavedLeaveDialog open={leaveTarget !== null} subject="書きかけの問い合わせ" onConfirm={confirmLeave} onCancel={cancelLeave} />

        {/* 送信完了の知らせ（2026-09-18 決定：帯だけでは気づきにくいので、窓で止めて伝える） */}
        <Dialog
          open={sent !== null}
          title="送信完了しました"
          description={sent?.notified
            ? '運営に届きました。控えが登録メールアドレスにも届きます。返信は登録メールアドレスと、この画面の「これまでの問い合わせ」に届きます（平日 2営業日以内）。'
            : '運営に届きました。控えメールは送れませんでしたが、内容は運営に届いています。返信はこの画面の「これまでの問い合わせ」に届きます。'}
          titleIcon={<CheckCircle2 aria-hidden="true" className={styles.doneIcon} />}
          onCancel={() => setSent(null)}
          designNode="b8xBtZ"
        >
          {sent?.ticketLabel ? <p className={styles.sentLine}>受付番号：<strong>{sent.ticketLabel}</strong>　件名：{sent.subject}</p> : null}
        </Dialog>

        <form
          className={styles.card}
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <div className={styles.pair}>
            <Field label="種類" htmlFor={`${uid}-kind`}>
              <Select
                aria-label="種類"
                id={`${uid}-kind`}
                size="full"
                value={input.kind}
                disabled={sending}
                onChange={(value) => set('kind', value as HqSupportKind | '')}
                options={[{ value: '', label: '種類を選んでください' }, ...kinds.map((k) => ({ value: k.key, label: supportKindWord(k.key, k.label) }))]}
              />
            </Field>
            <Field label="関係する店舗" htmlFor={`${uid}-account`}>
              <Select
                aria-label="関係する店舗"
                id={`${uid}-account`}
                size="full"
                value={input.lineAccountId}
                disabled={sending}
                onChange={(value) => set('lineAccountId', value)}
                options={[{ value: '', label: '指定しない' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
              />
            </Field>
          </div>

          <Field label="件名" htmlFor={`${uid}-subject`} tone="large">
            <TextField
              id={`${uid}-subject`}
              value={input.subject}
              maxLength={SUPPORT_SUBJECT_MAX}
              disabled={sending}
              placeholder="例：バナー生成で日本語の文字が崩れることがある"
              onChange={(e) => set('subject', e.target.value)}
              className={styles.full}
            />
          </Field>

          <Field label="本文" htmlFor={`${uid}-body`}>
            <TextArea
              id={`${uid}-body`}
              value={input.body}
              maxLength={SUPPORT_BODY_MAX}
              disabled={sending}
              placeholder="困っていること・期待する動き・起きた日時"
              onChange={(e) => set('body', e.target.value)}
              className={styles.textarea}
            />
          </Field>

          {/* 本物の file input は出さない。開くのは下の「画像を添える」から。 */}
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
          {attachments.length < SUPPORT_ATTACHMENT_MAX ? (
            <button type="button" className={styles.attach} disabled={sending} onClick={() => fileRef.current?.click()}>
              <ImagePlus aria-hidden="true" className={styles.attachIcon} />
              {`画像を添える（PNG・JPEG、1枚 5MB まで）`}
            </button>
          ) : null}

          <div className={styles.sender}>
            <span className={styles.senderText} title="この内容が問い合わせに添えられます。返信はこのメールアドレスに届きます。">
              {`送信者：${sender.name || '—'}${sender.email ? `（${sender.email}）` : ''}・統括：${sender.tenantName || '—'}・プラン：${sender.planLabel}`}
            </span>
            {!tenantUnavailable ? (
              <button type="button" onClick={() => setLineGuide(true)} className={styles.linkButton}>
                運営からの大事なお知らせを LINE で受け取る
              </button>
            ) : null}
          </div>

          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          {blocked && (input.subject || input.body || input.kind) ? <p className={styles.warn} role="alert">{blocked}</p> : null}

          <div className={styles.actions}>
            <Button onClick={clear} disabled={sending}>内容をクリア</Button>
            <Button variant="primary" onClick={() => void send()} disabled={sending || Boolean(blocked)} busy={sending} busyLabel="送信中…">
              <Plus aria-hidden="true" className={styles.buttonIcon} />送信
            </Button>
          </div>
        </form>

        <section aria-label="これまでの問い合わせ" className={styles.history}>
          <h2 className={styles.historyTitle}>これまでの問い合わせ</h2>
          {history === null ? (
            <p className={styles.empty}>読み込んでいます…</p>
          ) : historyError ? (
            <p className={styles.empty}>
              履歴を読み込めませんでした。
              <button type="button" onClick={() => void loadHistory()} className={styles.linkButton}>もう一度読み込む</button>
            </p>
          ) : history.length === 0 ? (
            <p className={styles.empty}>まだ問い合わせはありません。</p>
          ) : (
            <div className={styles.table} role="table" aria-label="これまでの問い合わせ">
              <div className={styles.head} role="row">
                <span role="columnheader">受付番号</span>
                <span role="columnheader">件名</span>
                <span role="columnheader">種類</span>
                <span role="columnheader">状態</span>
                <span role="columnheader">更新</span>
              </div>
              {history.slice(0, 10).map((item) => (
                <div key={item.id} className={styles.row} role="row">
                  <span role="cell">{item.ticketLabel ?? '—'}</span>
                  <span role="cell" className={styles.subjectCell}>
                    <Link href={`/hq/support/detail?id=${encodeURIComponent(item.id)}`} className={styles.subject} title={item.subject}>{item.subject}</Link>
                    {!tenantUnavailable && item.replies && item.replies.length > 0 ? (
                      <span className={styles.replyNote}>運営からの返信 {item.replies.length}件・開いて続きを送れます</span>
                    ) : null}
                  </span>
                  <span role="cell" className={styles.cell} title={item.kindLabel}>{supportKindWord(item.kind, item.kindLabel)}</span>
                  <span role="cell">
                    <StatusPill tone={item.status === 'open' ? 'warning' : 'success'}>{SUPPORT_STATUS_WORDS[item.status]}</StatusPill>
                  </span>
                  <span role="cell">{supportTime(item.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </ListPage>
  )
}

function Field({ label, htmlFor, tone, children }: { label: string; htmlFor: string; tone?: 'large'; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <label htmlFor={htmlFor} className={tone === 'large' ? styles.labelLarge : styles.label}>{label}</label>
      {children}
    </div>
  )
}
