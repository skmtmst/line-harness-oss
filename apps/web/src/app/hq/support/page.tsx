'use client'

import ReadonlyHeader from '@/app/hq/readonly-header-v8'
import '@/app/hq/readonly-v8.css'
import { Building2, CheckCircle2, CreditCard, ImagePlus, LifeBuoy, Plus, Users, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import Button from '@/components/shared/button'
import { describeApiFailure, japaneseDetailOf } from '@/components/shared/api-error-message'
import Dialog from '@/components/shared/dialog'
import NoticeLineRegisterDialog from '@/components/hq/notice-line-register-dialog'
import Select from '@/components/shared/select'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextArea, TextField } from '@/components/shared/text-field'
import { RequiredBadge } from '@/components/shared/form-controls'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useTenantStatus } from '@/components/tenant-access-context'
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
  type HqSupportContext,
  type HqSupportInput,
  type HqSupportKind,
  type HqSupportRequest,
} from '@/lib/hq-support'

type Attachment = { name: string; mimeType: string; data: string; size: number; previewUrl: string }

/**
 * お問い合わせ。板 `b8xBtZ`（運営LINEの登録ダイアログを開いた状態が `D6fh3`）。
 * 統括から運営（musubo 提供元）へ送る。
 *
 * E 作成型: 板の頭 → 左に統括の設定メニュー → 右に問い合わせカード＋履歴の表。
 * 送るとこの統括の記録に残り、運営へメールで知らせ、送信者には控えが届く。
 */
export default function HqSupportPage() {
  usePageTitle('お問い合わせ')
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

  useEffect(() => {
    let cancelled = false
    void api.hqSupport.context().then((res) => {
      if (cancelled || !res.success) return
      // 2026-09-25: 偽APIの既定の器（`{items,total,page,limit}`）が返ると
      // `kinds.map` で画面ごと落ちた。形が違っても入力欄は出す。
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
      /*
       * 確定応答を失った再送でも履歴で確かめられるよう、履歴を読み直す。
       * 送り直し自体は口側の重複防止（M028）で二重にならない。
       */
      void loadHistory()
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
    <div data-design-node="b8xBtZ" className="flex flex-col gap-4">
      <ReadonlyHeader title="お問い合わせ" description="使い方の質問・不具合・料金の相談を運営へ送れます。返信は登録メールアドレスと、下の「これまでの問い合わせ」に届きます（平日 2営業日以内）。" />

      {/* 契約者専用LINEの登録案内（2026-09-18 決定: 登録直後の案内を、ここからもいつでも開ける。開いた状態が板 D6fh3） */}
      {!tenantUnavailable ? <NoticeLineRegisterDialog open={lineGuide} onClose={() => setLineGuide(false)} quietWhenUnavailable={false} /> : null}

      {/* 送信完了の知らせ（2026-09-18 決定: 帯だけでは気づきにくいので、窓で止めて伝える） */}
      <Dialog
        open={sent !== null}
        title="送信完了しました"
        description={sent?.notified
          ? '運営に届きました。控えが登録メールアドレスにも届きます。返信は登録メールアドレスと、この画面の「これまでの問い合わせ」に届きます（平日 2営業日以内）。'
          : '運営に届きました。控えメールは送れませんでしたが、内容は運営に届いています。返信はこの画面の「これまでの問い合わせ」に届きます。'}
        titleIcon={<CheckCircle2 aria-hidden="true" className="h-5 w-5 text-accent-deep" />}
        onCancel={() => setSent(null)}
        designNode="b8xBtZ"
      >
        {sent?.ticketLabel ? <p className="text-label text-ink">受付番号：<span className="font-semibold">{sent.ticketLabel}</span>　件名：{sent.subject}</p> : null}
      </Dialog>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <nav aria-label="統括の設定" className="flex shrink-0 flex-col gap-1 xl:w-48">
          <p className="px-2 py-1 text-micro font-semibold text-ink-faint">統括の設定</p>
          <SettingsNavLink href="/hq/members" icon={<Users aria-hidden="true" className="h-4 w-4" />}>メンバー</SettingsNavLink>
          <SettingsNavLink href="/hq/settings" icon={<Building2 aria-hidden="true" className="h-4 w-4" />}>統括の情報</SettingsNavLink>
          <SettingsNavLink href="/hq/billing" icon={<CreditCard aria-hidden="true" className="h-4 w-4" />}>請求</SettingsNavLink>
          <SettingsNavLink href="/hq/support" current icon={<LifeBuoy aria-hidden="true" className="h-4 w-4" />}>お問い合わせ</SettingsNavLink>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <form
            className="flex min-w-0 flex-col gap-4 rounded-card border border-hairline bg-canvas p-5"
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="種類" required htmlFor={`${uid}-kind`}>
                <Select
                  aria-label="種類"
                  id={`${uid}-kind`}
                  size="full"
                  value={input.kind}
                  disabled={sending}
                  onChange={(value) => set('kind', value as HqSupportKind | '')}
                  options={[{ value: '', label: '種類を選んでください' }, ...kinds.map((k) => ({ value: k.key, label: k.label }))]}
                />
              </Field>

              <Field label="関係する店舗" note="任意" htmlFor={`${uid}-account`}>
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

            <div className="flex flex-col gap-1.5">
              <span className="text-label font-medium text-ink">画像を添える（任意・{SUPPORT_ATTACHMENT_MAX}枚まで）</span>
              {/*
                本物の file input は出さない（display:none）。
                開くのは下の「クリックして画像を選ぶ」ボタンから。
              */}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
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
                <Button variant="secondary"
                  type="button"
                  disabled={sending}
                  onClick={() => fileRef.current?.click()}
                  style={{ width: '100%', height: 72, fontSize: 12, gap: 8 }}
                >
                  <ImagePlus aria-hidden="true" className="h-4.5 w-4.5" />
                  クリックして画像を選ぶ（PNG・JPEG、1枚 5MB まで）
                </Button>
              ) : null}
            </div>

            <p className="rounded-control bg-shell px-3 py-2 text-micro text-ink-secondary">
              送信者：{sender.name || '—'}{sender.email ? `（${sender.email}）` : ''}・統括：{sender.tenantName || '—'}・プラン：{sender.planLabel}
              {tenantUnavailable ? 'この内容が問い合わせに添えられます。' : 'この内容が問い合わせに添えられます。返信はこのメールアドレスに届きます。'}
              {!tenantUnavailable ? (
                <button type="button" onClick={() => setLineGuide(true)} className="ml-2 text-action underline-offset-2 hover:underline">
                  運営からの大事なお知らせを LINE で受け取る
                </button>
              ) : null}
            </p>

            {error ? <p className="text-label text-danger" role="alert">{error}</p> : null}
            {blocked && (input.subject || input.body || input.kind) ? <p className="text-label text-status-warn-deep" role="alert">{blocked}</p> : null}

            <div className="flex items-center justify-end gap-2">
              <Button onClick={clear} disabled={sending}>内容をクリア</Button>
              <Button variant="primary" onClick={() => void send()} disabled={sending || Boolean(blocked)} busy={sending} busyLabel="送信中…">
                <Plus aria-hidden="true" className="h-4 w-4" />送信
              </Button>
            </div>
          </form>

          <section aria-label="これまでの問い合わせ" className="flex flex-col gap-2">
            <h2 className="text-body font-bold text-ink">これまでの問い合わせ</h2>
            {history === null ? (
              <p className="text-caption text-ink-faint">読み込んでいます…</p>
            ) : historyError ? (
              <div className="flex items-center gap-3 rounded-card border border-hairline bg-canvas px-4 py-4">
                {/*
                  M027：履歴の読込失敗に再試行口を付ける。
                  読み込めなかった表示に赤は使わない（★V7）。
                */}
                <p className="text-caption text-ink-secondary">履歴を読み込めませんでした。</p>
                <button
                  type="button"
                  onClick={() => void loadHistory()}
                  className="shrink-0 text-caption font-semibold text-action underline underline-offset-2"
                >
                  もう一度読み込む
                </button>
              </div>
            ) : history.length === 0 ? (
              <p className="rounded-card border border-hairline bg-canvas px-4 py-4 text-caption text-ink-faint">まだ問い合わせはありません。</p>
            ) : (
              <DataTable>
                <TableHeadRow>
                  <Th>受付番号</Th>
                  <Th>件名</Th>
                  <Th>種類</Th>
                  <Th>状態</Th>
                  <Th>更新</Th>
                </TableHeadRow>
                {history.slice(0, 10).map((item) => (
                  <Tr key={item.id}>
                    <Td><span className="text-label text-ink-secondary">{item.ticketLabel ?? '—'}</span></Td>
                    <Td>
                      <Link href={`/hq/support/detail?id=${encodeURIComponent(item.id)}`} className="text-label font-semibold text-action hover:underline">
                        {item.subject}
                      </Link>
                      {!tenantUnavailable && item.replies && item.replies.length > 0 ? (
                        <span className="block text-micro text-ink-secondary">運営からの返信 {item.replies.length}件・開いて続きを送れます</span>
                      ) : null}
                    </Td>
                    <Td><span className="text-label text-ink">{item.kindLabel}</span></Td>
                    <Td>
                      <span
                        className={
                          item.status === 'open'
                            ? 'inline-flex h-4.5 items-center gap-1 rounded-pill bg-status-info-soft px-2 text-nano font-medium text-status-info'
                            : 'inline-flex h-4.5 items-center gap-1 rounded-pill bg-accent-soft px-2 text-nano font-medium text-accent-deep'
                        }
                      >
                        <span aria-hidden="true" className="h-1 w-1 rounded-pill bg-current" />
                        {SUPPORT_STATUS_LABELS[item.status]}
                      </span>
                    </Td>
                    <Td><span className="text-label text-ink-secondary">{shortDateTime(item.createdAt)}</span></Td>
                  </Tr>
                ))}
              </DataTable>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function SettingsNavLink({ href, icon, current, children }: { href: string; icon: ReactNode; current?: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={
        current
          ? 'flex items-center gap-2 rounded-control bg-surface-pearl px-2 py-1.5 text-label font-semibold text-ink'
          : 'flex items-center gap-2 rounded-control px-2 py-1.5 text-label text-ink-secondary hover:bg-canvas-sunken hover:text-ink'
      }
    >
      {icon}
      {children}
    </Link>
  )
}

function Field({ label, required, note, htmlFor, children }: { label: string; required?: boolean; note?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <label htmlFor={htmlFor} className="text-label font-medium text-ink">{label}</label>
        {/* #976 U086: 必須の印は共通の「必須」札 */}
        {required ? <RequiredBadge /> : null}
        {note ? <span className="text-micro text-ink-faint">{note}</span> : null}
      </div>
      {children}
    </div>
  )
}
