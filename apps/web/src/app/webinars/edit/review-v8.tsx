'use client'

/*
 * ★V8 公開の前に確かめる（`XCUNf`）。
 * v7 の見た目は 1画素も変えない。編集画面で data-theme="v8" のときだけ、
 * 確認の段をこの部品で描く（V7 の ReviewStep は触らない）。
 *
 * 検査の中身・公開の動きは ReviewStep と同じ口（公開前検査・公開）を使う。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import { formatNumber } from '@/lib/format'
import { publicationStateLabel } from '@/components/webinars/publication-label'
import { webinarErrorText } from '@/components/webinars/webinar-error-text'
import {
  webinarApi,
  type Webinar,
  type WebinarEditor,
  type WebinarPublishValidation,
} from '@/lib/api'
import { publishBlockers } from './edit-steps'
import { reviewActionSummaryText, reviewMonitoringText, reviewTestSummaryBody } from './review-text'

const NOTIFICATION_FLAGS = [
  'registrationEnabled',
  'dayBeforeEnabled',
  'hourBeforeEnabled',
  'startEnabled',
  'missedEnabled',
  'completedEnabled',
] as const

export default function ReviewV8({
  webinar,
  editor,
  registrations,
  ctaCount,
  onPublished,
  onTestNotifications,
}: {
  webinar: Webinar
  editor: WebinarEditor
  registrations: number | null
  ctaCount: number
  onPublished: () => void
  onTestNotifications: () => void
}) {
  const [validation, setValidation] = useState<WebinarPublishValidation | null>(null)
  const [validationState, setValidationState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState('')
  const [testing, setTesting] = useState(false)
  const [testNotice, setTestNotice] = useState('')
  const [notificationCount, setNotificationCount] = useState<number | null>(null)
  const validationRequestId = useRef(0)

  const loadValidation = useCallback(() => {
    const requestId = ++validationRequestId.current
    setValidationState('loading')
    webinarApi
      .publishValidation(webinar.id)
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
    webinarApi
      .notifications(webinar.id)
      .then((res) => {
        const settings = res.data.settings
        if (!settings) {
          setNotificationCount(null)
          return
        }
        setNotificationCount(NOTIFICATION_FLAGS.filter((flag) => settings[flag]).length)
      })
      .catch(() => setNotificationCount(null))
    return () => {
      validationRequestId.current += 1
    }
  }, [loadValidation, webinar.id])

  const blockers = validation
    ? validation.checks.filter((check) => check.status === 'failed').map((check) => check.detail || check.label)
    : publishBlockers(webinar)
  const passed = validation?.checks.filter((check) => check.status === 'passed').length ?? 0
  const total = validation?.checks.length ?? 0
  const monitoringFailures =
    editor.monitoring.notificationFailures + editor.monitoring.viewSegmentFailures + editor.monitoring.actionFailures

  const testPublicPage = async () => {
    setTesting(true)
    setTestNotice('')
    try {
      const response = await webinarApi.testPublicPage(webinar.id, editor.version)
      setTestNotice(
        response.data.publicPage.test?.status === 'passed'
          ? '公開ページを確認しました。'
          : '公開ページに未設定があります。',
      )
    } catch (cause) {
      setTestNotice(webinarErrorText(cause, '公開ページを確認できませんでした。'))
    } finally {
      setTesting(false)
    }
  }

  const publish = async () => {
    setPublishing(true)
    setPublishError('')
    try {
      await webinarApi.publish(webinar.id, editor.version)
      onPublished()
      window.location.assign(`/webinars/published?id=${encodeURIComponent(webinar.id)}`)
    } catch (cause) {
      setPublishError(webinarErrorText(cause, '公開できませんでした'))
      setPublishing(false)
    }
  }

  const publication = publicationStateLabel(
    webinar.publicationState,
    webinar.publicationStartsAt,
    webinar.publicationEndsAt,
  )

  return (
    <div className="flex flex-col gap-4 xl:flex-row" data-design-node="XCUNf">
      <div className="min-w-0 flex-1 space-y-3">
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card" aria-label="公開前の確認">
          <h2 className="text-ink text-base font-bold">
            公開前の確認{' '}
            {validationState === 'ready' ? (
              <span className="text-ink-secondary text-sm font-semibold">
                {passed}/{total}
              </span>
            ) : null}
          </h2>
          <p className="text-ink-faint mt-1 text-xs">8つ全部が通ると公開できます。</p>
          {validationState === 'ready' && blockers.length > 0 ? (
            <Notice tone="warn">
              <p className="font-bold">このままでは公開できません：{blockers[0]}</p>
            </Notice>
          ) : null}
          <ul className="divide-hairline mt-3 divide-y rounded-control border border-hairline">
            {(validation?.checks ?? []).map((check) => (
              <li key={check.key} className="flex items-center gap-3 px-4 py-3">
                <span
                  className={
                    check.status === 'passed'
                      ? 'bg-accent-soft text-accent-deep inline-flex shrink-0 items-center rounded-pill px-2 py-0.5 text-xs font-semibold'
                      : 'bg-danger-soft text-danger inline-flex shrink-0 items-center rounded-pill px-2 py-0.5 text-xs font-semibold'
                  }
                >
                  {check.status === 'passed' ? 'できた' : 'まだ'}
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="text-ink block text-sm">{check.label}</strong>
                  {check.detail ? <span className="text-ink-faint block text-xs">{check.detail}</span> : null}
                </span>
              </li>
            ))}
            {validationState === 'loading' ? (
              <li className="text-ink-faint px-4 py-3 text-sm">公開前検査を読み込んでいます。</li>
            ) : null}
          </ul>
          {validationState === 'error' ? (
            <div className="mt-3">
              <Button onClick={loadValidation}>もう一度読み込む</Button>
            </div>
          ) : null}
          {validationState === 'ready' && blockers.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" busy={testing} busyLabel="確認中…" onClick={() => void testPublicPage()}>
                ページをテスト
              </Button>
              <Button variant="secondary" onClick={onTestNotifications}>
                通知のテストを送る
              </Button>
            </div>
          ) : null}
          {testNotice ? (
            <p className="text-ink-secondary mt-2 text-xs" role="status">
              {testNotice}
            </p>
          ) : null}
        </section>

        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card" aria-label="設定のまとめ">
          <h2 className="text-ink text-base font-bold">設定のまとめ</h2>
          <dl className="divide-hairline mt-3 divide-y rounded-control border border-hairline">
            <div className="flex items-baseline justify-between gap-4 px-4 py-3">
              <dt className="text-ink-faint text-xs font-semibold">開催形式</dt>
              <dd className="text-ink text-right text-sm">
                {webinar.schedule.length > 0 ? '日時指定・開催回あり' : 'オンデマンド・いつでも視聴'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 px-4 py-3">
              <dt className="text-ink-faint text-xs font-semibold">公開期間</dt>
              <dd className="text-ink text-right text-sm">{publication ?? '—（公開期間は未設定）'}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 px-4 py-3">
              <dt className="text-ink-faint text-xs font-semibold">CTA</dt>
              <dd className="text-ink text-right text-sm">
                {ctaCount > 0 ? `${ctaCount}件` : webinar.cta ? '動画＋CTA＋フォーム' : '未設定'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 px-4 py-3">
              <dt className="text-ink-faint text-xs font-semibold">通知</dt>
              <dd className="text-ink text-right text-sm">
                {notificationCount === null ? '—' : `${notificationCount}つ`}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 px-4 py-3">
              <dt className="text-ink-faint text-xs font-semibold">視聴後の動き</dt>
              <dd className="text-ink text-right text-sm">{reviewActionSummaryText(validation)}</dd>
            </div>
          </dl>
          <div className="mt-3">
            <Button
              variant="primary"
              disabled={!validation || blockers.length > 0 || publishing}
              busy={publishing}
              busyLabel="公開中…"
              onClick={() => void publish()}
            >
              この版を公開
            </Button>
          </div>
          {publishError ? (
            <p className="text-danger mt-2 text-xs" role="alert">
              {publishError}
            </p>
          ) : null}
          <p className="text-ink-faint mt-2 text-xs">公開時点の版を固定し、編集中の下書きとは分けて保存します。</p>
        </section>
      </div>

      <aside className="w-full shrink-0 xl:w-95" aria-label="公開ページでの見え方">
        <div className="border-hairline bg-canvas rounded-card border p-4 shadow-card xl:sticky xl:top-4">
          <h2 className="text-ink text-base font-bold">公開ページでの見え方</h2>
          <p className="text-ink mt-2 truncate text-sm font-semibold">{webinar.title}</p>
          <p className="text-ink-faint mt-1 text-xs">{reviewTestSummaryBody(validation, validationState)}</p>
          <p className="text-ink-faint mt-1 text-xs">
            {reviewMonitoringText(monitoringFailures)}・
            {registrations === null ? '申込見込み—' : `申込見込み ${formatNumber(registrations)}人`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" busy={testing} busyLabel="確認中…" onClick={() => void testPublicPage()}>
              ページをテスト
            </Button>
            <Button variant="secondary" onClick={onTestNotifications}>
              テストを送る
            </Button>
          </div>
          {testNotice ? (
            <p className="text-ink-secondary mt-2 text-xs" role="status">
              {testNotice}
            </p>
          ) : null}
        </div>
      </aside>
    </div>
  )
}
