'use client'

/*
 * ★V8-B ウェビナー編集⑤確認（板 `XCUNf`）。
 *
 * 見本の形：公開前の確認（8つの項目のできた・まだと、まだの理由・
 * 日時・件数）と設定のまとめ、右に公開ページでの見え方。
 * 「この版を公開」はここで持つ（検査が通るまで押せない）。
 * 口は v7 と同じ（`publishValidation`・`publish`・`videoAsset`・
 * `testPublicPage`・`testNotifications`）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import StatusBadge from '@/components/shared/status-badge'
import { webinarApi, type Webinar, type WebinarEditor, type WebinarPublishValidation } from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'
import { webinarErrorText } from '@/components/webinars/webinar-error-text'
import styles from './review-v8.module.css'

function formatTestedAt(value: string | null | undefined): string {
  if (!value) return ''
  try {
    const date = new Date(value)
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  } catch {
    return ''
  }
}

export default function ReviewStepV8({ webinar, editor, ctaCount, publicUrl, canOpenPublicPage, publicPageReason, onEditorChange, onBack, onPublished }: {
  webinar: Webinar
  editor: WebinarEditor
  ctaCount: number
  publicUrl: string | null
  canOpenPublicPage: boolean
  publicPageReason: string
  onEditorChange: (editor: WebinarEditor) => void
  onBack: (key: 'basic' | 'video' | 'cta' | 'notifications') => void
  onPublished: () => void
}) {
  const [validation, setValidation] = useState<WebinarPublishValidation | null>(null)
  const [validationState, setValidationState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [videoReady, setVideoReady] = useState<boolean | null>(null)
  const [notifySummary, setNotifySummary] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState('')
  const [testingPage, setTestingPage] = useState(false)
  const [pageNotice, setPageNotice] = useState('')
  const [testConfirmOpen, setTestConfirmOpen] = useState(false)
  const [testingNotify, setTestingNotify] = useState(false)
  const [notifyResult, setNotifyResult] = useState('')
  const validationRequestId = useRef(0)

  const loadValidation = useCallback(() => {
    const requestId = ++validationRequestId.current
    setValidationState('loading')
    webinarApi.publishValidation(webinar.id)
      .then((response) => {
        if (requestId !== validationRequestId.current) return
        setValidation(response.data)
        setValidationState('ready')
      })
      .catch(() => {
        if (requestId !== validationRequestId.current) return
        setValidation(null)
        setValidationState('error')
      })
  }, [webinar.id])

  useEffect(() => {
    loadValidation()
    let cancelled = false
    webinarApi.videoAsset(webinar.id)
      .then((res) => { if (!cancelled) setVideoReady(res.data.asset?.stage === 'ready') })
      .catch(() => { if (!cancelled) setVideoReady(null) })
    webinarApi.notifications(webinar.id)
      .then((res) => {
        if (cancelled) return
        const settings = res.data.settings
        if (!settings) {
          setNotifySummary(null)
          return
        }
        const enabled = [
          settings.registrationEnabled,
          settings.dayBeforeEnabled,
          settings.hourBeforeEnabled,
          settings.startEnabled,
          settings.missedEnabled,
          settings.completedEnabled,
        ].filter(Boolean).length
        setNotifySummary(`${enabled}つ${settings.missedEnabled ? '' : '（見逃し案内は止めている）'}`)
      })
      .catch(() => { if (!cancelled) setNotifySummary(null) })
    return () => {
      validationRequestId.current += 1
      cancelled = true
    }
  }, [loadValidation, webinar.id])

  const checkStatus = (key: string): 'passed' | 'warning' | 'failed' | null =>
    validation?.checks.find((check) => check.key === key)?.status ?? null

  const formActive = editor.publicPage.form?.active === true
  const notifyTestPassed = editor.notificationTest?.status === 'passed'
  const pageTestPassed = editor.publicPage.test?.status === 'passed'
  const frameCount = webinar.schedule.length

  const items: Array<{ label: string; done: boolean | null; note: string }> = [
    { label: '動画の準備ができている', done: videoReady, note: '' },
    { label: '申込フォームが公開中', done: editor.publicPage.form ? formActive : null, note: '' },
    { label: 'CTAの時刻とリンク', done: ctaCount > 0 ? true : validation ? checkStatus('cta') !== 'failed' : null, note: '' },
    { label: '配信枠が1件以上', done: frameCount > 0, note: frameCount > 0 ? `${frameCount}件` : '' },
    { label: '通知のテスト送信', done: notifyTestPassed, note: formatTestedAt(editor.notificationTest?.testedAt) },
    { label: '公開ページを確かめた', done: pageTestPassed, note: pageTestPassed ? '' : 'ページをテストしてください' },
    { label: '通知が重なっていない', done: checkStatus('notification_duplicates') === 'passed' ? true : checkStatus('notification_duplicates') === null ? null : false, note: '' },
    { label: 'アクションの参照先がある', done: checkStatus('action_dependencies') === 'passed' ? true : checkStatus('action_dependencies') === null ? null : false, note: '' },
  ]
  const doneCount = items.filter((item) => item.done === true).length
  const blockers = validation
    ? validation.checks.filter((check) => check.status === 'failed').map((check) => check.detail || check.label)
    : []
  const firstBlocker = blockers[0] ?? null

  const publish = async () => {
    setPublishing(true)
    setPublishError('')
    try {
      await webinarApi.publish(webinar.id, editor.version)
      /*
        公開できたあとの遷移は「入力を捨てる離脱」ではない。未保存の印が
        残っていてもブラウザ標準の離脱確認が出ないよう、遷移の直前に
        未保存ガードを外す。
      */
      onPublished()
      window.location.assign(`/webinars/published?id=${encodeURIComponent(webinar.id)}`)
    } catch (cause) {
      setPublishError(webinarErrorText(cause, '公開できませんでした'))
      setPublishing(false)
    }
  }

  const testPage = async () => {
    setTestingPage(true)
    setPageNotice('')
    try {
      const response = await webinarApi.testPublicPage(webinar.id, editor.version)
      onEditorChange(response.data)
      setPageNotice(response.data.publicPage.test?.status === 'passed' ? '公開ページを確認しました。' : '公開ページに未設定があります。')
    } catch (cause) {
      setPageNotice(webinarErrorText(cause, '公開ページを確認できませんでした。'))
    } finally {
      setTestingPage(false)
    }
  }

  const runNotificationTest = async () => {
    setTestConfirmOpen(false)
    setTestingNotify(true)
    setNotifyResult('')
    try {
      const response = await webinarApi.testNotifications(webinar.id)
      setNotifyResult(`テスト送信しました。成功 ${response.data.sent}件・失敗 ${response.data.failed}件`)
      webinarApi.editor(webinar.id)
        .then((editorResponse) => onEditorChange(editorResponse.data))
        .catch(() => undefined)
    } catch (cause) {
      setNotifyResult(webinarErrorText(cause, 'テスト送信できませんでした。時間をおいてもう一度お試しください。'))
    } finally {
      setTestingNotify(false)
    }
  }

  const notifyTestDone = editor.notificationTest?.status === 'passed'

  return (
    <div className={styles.columns}>
      <div className={styles.main}>
        <section className={styles.card} aria-label="公開前の確認">
          <h2 className={styles.cardTitle}>公開前の確認 {doneCount}/{items.length}</h2>
          <p className={styles.cardDesc}>{items.length}つ全部が通ると公開できます。</p>
          {validationState === 'loading' ? <ListState kind="loading" /> : (
            <ul className={styles.rows}>
              {items.map((item) => (
                <li key={item.label} className={styles.row}>
                  <StatusBadge tone={item.done === true ? 'success' : item.done === false ? 'danger' : 'neutral'}>
                    {item.done === true ? 'できた' : item.done === false ? 'まだ' : '確認中'}
                  </StatusBadge>
                  <span className={styles.rowTitle}>{item.label}</span>
                  {item.note ? <span className={styles.rowNote}>{item.note}</span> : null}
                </li>
              ))}
            </ul>
          )}
          {validationState === 'error' ? (
            <Notice
              tone="danger"
              action={<Button onClick={loadValidation}>もう一度読み込む</Button>}
            >
              公開前検査を読み込めませんでした。このままでは公開できません。
            </Notice>
          ) : null}
          {firstBlocker ? <p className={styles.blocker}>このままでは公開できません：{firstBlocker}。</p> : null}
          <div className={styles.rowActions}>
            <Button variant="primary" disabled={testingPage} onClick={() => void testPage()} busy={testingPage} busyLabel="確認中…">ページをテスト</Button>
            <Button disabled={testingNotify || notifyTestDone} onClick={() => setTestConfirmOpen(true)} busy={testingNotify} busyLabel="送信中…">{notifyTestDone ? '通知のテスト済み' : '通知のテストを送る'}</Button>
          </div>
          {pageNotice ? <p className="text-ink-secondary text-xs">{pageNotice}</p> : null}
          {notifyResult ? <p className="text-ink-secondary text-xs" role="status">{notifyResult}</p> : null}
        </section>
        <section className={styles.card} aria-label="設定のまとめ">
          <h2 className={styles.cardTitle}>設定のまとめ</h2>
          <dl className={styles.summary}>
            <div className={styles.summaryRow}><dt>開催形式</dt><dd>{editor.deliveryKind === 'scheduled' ? '日時指定配信' : 'オンデマンド・いつでも視聴'}</dd></div>
            <div className={styles.summaryRow}><dt>公開期間</dt><dd>{webinar.publicationStartsAt ? `${formatDateTime(webinar.publicationStartsAt)}から` : '未設定'}</dd></div>
            <div className={styles.summaryRow}><dt>CTA</dt><dd>{ctaCount > 0 ? `${ctaCount}件` : '未設定'}</dd></div>
            <div className={styles.summaryRow}><dt>通知</dt><dd>{notifySummary ?? '—'}</dd></div>
          </dl>
        </section>
        <div className={styles.rowActions}>
          <Button onClick={() => onBack('basic')}>基本設定へ戻る</Button>
          <Button onClick={() => onBack('video')}>動画へ戻る</Button>
          <Button variant="primary" disabled={!validation || blockers.length > 0 || publishing} onClick={() => void publish()} busy={publishing} busyLabel="公開中…">この版を公開</Button>
        </div>
        {publishError ? <p className="text-danger text-xs" role="alert">{publishError}</p> : null}
        <p className="text-ink-faint text-xs">公開時点の版を固定し、編集中の下書きとは分けて保存します。</p>
      </div>
      <div>
        <h2 className={styles.previewTitle}>公開ページでの見え方</h2>
        <div className={styles.previewCard}>
          <p className={styles.previewHeading}>{webinar.title || '無題のウェビナー'}</p>
          <div className={styles.previewScreen} aria-hidden="true">▶</div>
        </div>
        <div className={styles.rowActions}>
          {canOpenPublicPage && publicUrl ? <Button href={publicUrl} target="_blank" rel="noreferrer">公開ページを見る</Button> : <Button disabled title={publicPageReason}>公開ページを見る</Button>}
          <Button onClick={() => void testPage()} disabled={testingPage} busy={testingPage} busyLabel="確認中…">テストを送る</Button>
        </div>
        {!(canOpenPublicPage && publicUrl) && publicPageReason ? <p className="text-ink-faint text-xs">{publicPageReason}</p> : null}
      </div>
      <ConfirmDialog
        open={testConfirmOpen}
        title="通知をテスト送信しますか？"
        description="アカウント設定で登録したテスト受信者へ、実際のLINEメッセージを送ります。申込者全員には届きません。"
        confirmLabel="テストを送る"
        busy={testingNotify}
        onCancel={() => { if (!testingNotify) setTestConfirmOpen(false) }}
        onConfirm={() => void runNotificationTest()}
      />
    </div>
  )
}
