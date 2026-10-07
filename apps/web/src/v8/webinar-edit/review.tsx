'use client'

/*
 * ★V8 ウェビナーの ⑤確認（Pencil XCUNf）。
 * 公開前の確認（検査の行：できた／まだ・右に中身）→ 公開できない理由 → ページをテスト・通知のテスト
 * → 設定のまとめ。右は公開ページでの見え方。下の帯の主ボタンは「この版を公開」。
 * 口・公開の決まりは app/webinars/edit/review-v8.tsx と同じ（BEHAVIOR.md）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, ExternalLink, Globe, Play, Send } from 'lucide-react'
import { CreatePage } from '@/components/templates'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Notice from '@/components/shared/notice'
import { publicationStateLabel } from '@/components/webinars/publication-label'
import { webinarErrorText } from '@/components/webinars/webinar-error-text'
import { webinarApi, type WebinarPublishValidation } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { EditContext, WizardChrome } from './types'
import form from './form.module.css'
import styles from './review.module.css'

const FLAGS = ['registrationEnabled', 'dayBeforeEnabled', 'hourBeforeEnabled', 'startEnabled', 'missedEnabled', 'completedEnabled'] as const

export default function ReviewPane({ ctx, chromeFor }: { ctx: EditContext; chromeFor: (primary: ReactNode) => WizardChrome }) {
  const { webinar, editor, readOnly } = ctx
  const [validation, setValidation] = useState<WebinarPublishValidation | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState('')
  const [testing, setTesting] = useState<false | 'page' | 'notify'>(false)
  const [notice, setNotice] = useState('')
  const [notifyConfirm, setNotifyConfirm] = useState(false)
  const [notifyCount, setNotifyCount] = useState<{ on: number; missedOff: boolean } | null>(null)
  const requestId = useRef(0)
  const lock = useRef(false)
  const version = useRef(editor.version)
  useEffect(() => { version.current = editor.version }, [editor.version])

  const load = useCallback(() => {
    const id = ++requestId.current
    setState('loading')
    setValidation(null)
    void webinarApi.publishValidation(webinar.id).then((response) => {
      if (!Array.isArray(response.data.checks)) throw new Error('invalid_validation')
      if (id !== requestId.current) return
      setValidation(response.data)
      setState('ready')
    }).catch(() => { if (id === requestId.current) setState('error') })
  }, [webinar.id])
  useEffect(() => {
    load()
    return () => { requestId.current += 1 }
  }, [load, editor.version])
  useEffect(() => {
    let active = true
    setNotifyCount(null)
    void webinarApi.notifications(webinar.id).then((response) => {
      const settings = response.data.settings
      if (active && settings) setNotifyCount({ on: FLAGS.filter((flag) => settings[flag]).length, missedOff: !settings.missedEnabled })
    }).catch(() => { if (active) setNotifyCount(null) })
    return () => { active = false }
  }, [webinar.id])

  const checks = validation?.checks ?? []
  const failed = checks.filter((check) => check.status === 'failed')
  const passed = checks.filter((check) => check.status === 'passed').length
  const canPublish = !readOnly && state === 'ready' && validation !== null && failed.length === 0 && !publishing && testing === false

  const testPage = async () => {
    if (lock.current) return
    lock.current = true
    setTesting('page')
    setNotice('')
    try {
      const response = await webinarApi.testPublicPage(webinar.id, version.current)
      version.current = response.data.version
      ctx.onEditorChange(response.data)
      setNotice(response.data.publicPage.test?.status === 'passed' ? '公開ページを確かめました。' : '公開ページに未設定があります。')
      load()
    } catch (cause) {
      setNotice(webinarErrorText(cause, '公開ページを確かめられませんでした。'))
    } finally {
      lock.current = false
      setTesting(false)
    }
  }
  const testNotify = async () => {
    if (lock.current) return
    lock.current = true
    setTesting('notify')
    setNotice('')
    try {
      const res = await webinarApi.testNotifications(webinar.id)
      setNotifyConfirm(false)
      setNotice(`通知をテスト送信しました。成功 ${res.data.sent}件・失敗 ${res.data.failed}件`)
      const refreshed = await webinarApi.editor(webinar.id)
      ctx.onEditorChange(refreshed.data)
    } catch (cause) {
      setNotice(webinarErrorText(cause, 'テスト送信できませんでした。時間をおいてもう一度お試しください。'))
    } finally {
      lock.current = false
      setTesting(false)
    }
  }
  const publish = async () => {
    if (!canPublish || lock.current) return
    lock.current = true
    setPublishing(true)
    setPublishError('')
    try {
      await webinarApi.publish(webinar.id, version.current)
      ctx.onPublished()
      window.location.assign(`/webinars/published?id=${encodeURIComponent(webinar.id)}`)
    } catch (cause) {
      setPublishError(webinarErrorText(cause, '公開できませんでした'))
      setPublishing(false)
      lock.current = false
    }
  }

  const summary: Array<[string, string]> = [
    ['開催形式', editor.deliveryKind === 'scheduled' ? '日時指定・開催回あり' : editor.deliveryKind === 'external' ? '外部の動画' : 'オンデマンド・いつでも視聴'],
    ['公開期間', publicationStateLabel(webinar.publicationState, webinar.publicationStartsAt, webinar.publicationEndsAt) ?? '—（公開期間は未設定）'],
    ['CTA', ctx.ctaCount > 0 ? `${ctx.ctaCount}件` : '未設定'],
    ['通知', notifyCount === null ? '—' : `${notifyCount.on} つ${notifyCount.missedOff ? '（見逃し案内は止めている）' : ''}`],
    ['視聴後の動き', (() => { const check = checks.find((item) => item.key === 'action_dependencies'); return check ? check.detail || check.label : '—' })()],
  ]
  const chrome = chromeFor(readOnly ? null : (
    <Button variant="primary" disabled={!canPublish} title={canPublish ? undefined : '公開前の確認が全部通ると公開できます'} busy={publishing} busyLabel="公開しています…" onClick={() => void publish()}><Check size={15} aria-hidden="true" />この版を公開</Button>
  ))

  return (
    <CreatePage
      boardId="XCUNf"
      title={chrome.title}
      identity={chrome.identity}
      steps={chrome.steps}
      description="すべての段がそろうと公開できます。公開すると、申込ページと LINE の案内が使えるようになります。"
      footerActions={chrome.footerActions}
      status={chrome.status}
      preview={<>
        <h2 className={form.previewTitle}>公開ページでの見え方</h2>
        <div className={styles.pageCard}>
          <p className={styles.pageTitle} title={webinar.title}>{webinar.title}</p>
          <span className={styles.player} aria-hidden="true"><Play size={32} /></span>
        </div>
        <div className={form.previewActions}>
          {ctx.canOpenPublicPage && ctx.publicUrl ? <Button href={ctx.publicUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} aria-hidden="true" />公開ページを見る</Button> : null}
          {readOnly ? null : <Button disabled={testing !== false || publishing} onClick={() => setNotifyConfirm(true)}><Send size={15} aria-hidden="true" />テストを送る</Button>}
        </div>
        {!ctx.canOpenPublicPage && ctx.publicPageReason ? <p className={form.previewNote}>{ctx.publicPageReason}</p> : null}
        {ctx.analytics ? <p className={form.previewNote}>{`申込 ${formatNumber(ctx.analytics.summary.reservations)}人`}</p> : null}
      </>}
    >
      <section className={form.card} data-gap="tight" aria-labelledby="webinar-review-title" data-wc-pane="review">
        <div className={form.cardHeadRow}><h2 id="webinar-review-title" className={form.cardTitle}>{state === 'ready' ? `公開前の確認 ${passed}/${checks.length}` : '公開前の確認'}</h2></div>
        <p className={styles.desc}>{state === 'ready' ? `${checks.length}つ全部が通ると公開できます。` : '公開に要るものを確かめます。'}</p>
        {state === 'error' ? <Notice tone="info" action={<Button onClick={load}>もう一度読み込む</Button>}>公開前の確認を読み込めませんでした。このままでは公開できません。</Notice> : null}
        {state === 'loading' ? <p className={form.cardNote} role="status">公開前の確認を読み込んでいます。</p> : null}
        {checks.map((check) => (
          <div key={check.key} className={styles.check}>
            <span className={form.pill} data-tone={check.status === 'passed' ? 'success' : check.status === 'warning' ? 'warn' : 'danger'}><span className={form.pillDot} aria-hidden="true" />{check.status === 'passed' ? 'できた' : 'まだ'}</span>
            <span className={`${styles.checkLabel} ${form.ellipsis}`} title={check.label}>{check.label}</span>
            {check.detail ? <span className={`${styles.checkDetail} ${form.ellipsis}`} title={check.detail}>{check.detail}</span> : null}
          </div>
        ))}
        {state === 'ready' && failed.length > 0 ? (
          <p className={styles.blocker} role="alert">{`このままでは公開できません：${(validation?.blockers.length ? validation.blockers : failed.map((check) => `${check.label}がまだです。`)).join('・')}`}</p>
        ) : state === 'ready' ? <p className={styles.ok}>必要なものはそろっています。</p> : null}
        {readOnly ? null : (
          <div className={form.buttons}>
            <Button variant={failed.some((check) => check.key === 'public_page_test') ? 'primary' : 'secondary'} disabled={testing !== false || publishing} busy={testing === 'page'} busyLabel="確かめています…" onClick={() => void testPage()}><Globe size={15} aria-hidden="true" />ページをテスト</Button>
            <Button disabled={testing !== false || publishing} onClick={() => setNotifyConfirm(true)}><Send size={15} aria-hidden="true" />通知のテストを送る</Button>
          </div>
        )}
        {notice ? <p className={form.cardNote} role="status">{notice}</p> : null}
        {publishError ? <p className={form.fieldError} role="alert">{publishError}</p> : null}
      </section>

      <section className={form.card} aria-labelledby="webinar-summary-title">
        <div className={form.cardHead}><h2 id="webinar-summary-title" className={form.cardTitle}>設定のまとめ</h2></div>
        <dl className={styles.summary}>
          {summary.map(([label, value]) => (
            <div key={label} className={styles.summaryRow}>
              <dt className={styles.summaryLabel}>{label}</dt>
              <dd className={`${styles.summaryValue} ${form.ellipsis}`} title={value}>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <ConfirmDialog open={notifyConfirm} title="通知をテスト送信しますか？" description="アカウント設定で登録したテスト受信者へ、実際のLINEメッセージを送ります。申込者全員には届きません。" confirmLabel="テストを送る" busy={testing === 'notify'} onCancel={() => { if (testing === false) setNotifyConfirm(false) }} onConfirm={() => void testNotify()} />
    </CreatePage>
  )
}
