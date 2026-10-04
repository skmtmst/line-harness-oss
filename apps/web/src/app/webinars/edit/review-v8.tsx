'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import HelpTip from '@/components/shared/help-tip'
import StatusBadge from '@/components/shared/status-badge'
import StickyBar from '@/components/shared/sticky-bar'
import { formatNumber } from '@/lib/format'
import { publicationStateLabel } from '@/components/webinars/publication-label'
import { webinarErrorText } from '@/components/webinars/webinar-error-text'
import { webinarApi, type Webinar, type WebinarEditor, type WebinarPublishValidation } from '@/lib/api'
import { reviewActionSummaryText, reviewMonitoringText, reviewTestSummaryBody } from './review-text'
import { canManageRole, useStaffRole } from '@/lib/staff-role'

const NOTIFICATION_FLAGS = ['registrationEnabled', 'dayBeforeEnabled', 'hourBeforeEnabled', 'startEnabled', 'missedEnabled', 'completedEnabled'] as const

export default function ReviewV8({ webinar, editor, registrations, ctaCount, onPublished, onTestNotifications, onEditorChange, onBack, publicUrl, canOpenPublicPage, publicPageReason }: {
  webinar: Webinar
  editor: WebinarEditor
  registrations: number | null
  ctaCount: number
  onPublished: () => void
  onTestNotifications: () => void
  onEditorChange?: (editor: WebinarEditor) => void
  onBack?: () => void
  publicUrl?: string | null
  canOpenPublicPage?: boolean
  publicPageReason?: string
}) {
  const canEdit = canManageRole(useStaffRole())
  const [validation, setValidation] = useState<WebinarPublishValidation | null>(null)
  const [validationState, setValidationState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState('')
  const [testing, setTesting] = useState(false)
  const [testNotice, setTestNotice] = useState('')
  const [notificationCount, setNotificationCount] = useState<number | null>(null)
  const validationRequestId = useRef(0)
  const operationLock = useRef(false)
  const latestVersion = useRef(editor.version)
  useEffect(() => { latestVersion.current = editor.version }, [editor.version])

  const loadValidation = useCallback(() => {
    const requestId = ++validationRequestId.current
    setValidationState('loading')
    setValidation(null)
    void webinarApi.publishValidation(webinar.id).then((response) => {
      if (!Array.isArray(response.data.checks)) throw new Error('invalid_validation')
      if (requestId !== validationRequestId.current) return
      setValidation(response.data)
      setValidationState('ready')
    }).catch(() => {
      if (requestId === validationRequestId.current) setValidationState('error')
    })
  }, [webinar.id])

  useEffect(() => {
    loadValidation()
    return () => { validationRequestId.current += 1 }
  }, [loadValidation, editor.version])
  useEffect(() => {
    let active = true
    setNotificationCount(null)
    void webinarApi.notifications(webinar.id).then((response) => {
      const settings = response.data.settings
      if (active && settings) setNotificationCount(NOTIFICATION_FLAGS.filter((flag) => settings[flag]).length)
    }).catch(() => { if (active) setNotificationCount(null) })
    return () => { active = false }
  }, [webinar.id])

  const blockers = validation?.checks.filter((check) => check.status === 'failed') ?? []
  const canPublish = canEdit && validationState === 'ready' && validation !== null && blockers.length === 0 && !publishing && !testing
  const passed = validation?.checks.filter((check) => check.status === 'passed').length ?? 0
  const total = validation?.checks.length ?? 0
  const monitoringFailures = editor.monitoring.notificationFailures + editor.monitoring.viewSegmentFailures + editor.monitoring.actionFailures

  const testPublicPage = async () => {
    if (!canEdit || operationLock.current) return
    operationLock.current = true
    setTesting(true)
    setTestNotice('')
    try {
      const response = await webinarApi.testPublicPage(webinar.id, latestVersion.current)
      latestVersion.current = response.data.version
      onEditorChange?.(response.data)
      setTestNotice(response.data.publicPage.test?.status === 'passed' ? '公開ページを確認しました。' : '公開ページに未設定があります。')
      loadValidation()
    } catch (cause) {
      setTestNotice(webinarErrorText(cause, '公開ページを確認できませんでした。'))
    } finally {
      operationLock.current = false
      setTesting(false)
    }
  }

  const publish = async () => {
    if (!canPublish || operationLock.current) return
    operationLock.current = true
    setPublishing(true)
    setPublishError('')
    try {
      await webinarApi.publish(webinar.id, latestVersion.current)
      onPublished()
      window.location.assign(`/webinars/published?id=${encodeURIComponent(webinar.id)}`)
    } catch (cause) {
      setPublishError(webinarErrorText(cause, '公開できませんでした'))
      setPublishing(false)
      operationLock.current = false
    }
  }

  const rows = [
    ['開催形式', webinar.schedule.length > 0 ? '日時指定・開催回あり' : 'オンデマンド・いつでも視聴'],
    ['公開期間', publicationStateLabel(webinar.publicationState, webinar.publicationStartsAt, webinar.publicationEndsAt) ?? '—（公開期間は未設定）'],
    ['CTA', ctaCount > 0 ? `${ctaCount}件` : webinar.cta ? '動画＋CTA＋フォーム' : '未設定'],
    ['通知', notificationCount === null ? '—' : `${notificationCount}つ`],
    ['視聴後の動き', reviewActionSummaryText(validation)],
  ]

  return <div data-webinar-pane="review" data-design-node="XCUNf">
    <div className="space-y-3">
      {!canEdit ? <Notice tone="info">閲覧のみです。公開やテストはオーナーか管理者に依頼してください。</Notice> : null}
      <section className="border-hairline bg-canvas rounded-card border p-4" aria-label="公開前の確認">
        <div className="flex items-center gap-2"><h2 className="text-ink text-base font-semibold">公開前の確認</h2><HelpTip label="公開前の確認の説明">公開に必要な設定と、公開ページ・通知のテスト結果を確認します。公開すると、その時点の保存版を使います。</HelpTip>{validationState === 'ready' ? <span className="text-ink-secondary text-xs tabular-nums">{passed}/{total}</span> : null}</div>
        {validationState === 'error' ? <Notice tone="info" action={<Button onClick={loadValidation}>もう一度読み込む</Button>}>公開前検査を読み込めませんでした。このままでは公開できません。</Notice> : null}
        <ul className="divide-hairline mt-3 divide-y">
          {(validation?.checks ?? []).map((check) => <li key={check.key} className="flex items-center gap-3 py-3"><StatusBadge tone={check.status === 'passed' ? 'success' : check.status === 'warning' ? 'warning' : 'danger'}>{check.status === 'passed' ? 'できた' : 'まだ'}</StatusBadge><strong className="text-ink min-w-0 flex-1 truncate text-sm font-normal" title={check.label}>{check.label}</strong>{check.status === 'passed' && check.detail ? <HelpTip label={`${check.label}の詳細`}>{check.detail}</HelpTip> : null}</li>)}
          {validationState === 'loading' ? <li className="text-ink-faint py-3 text-sm" role="status">公開前検査を読み込んでいます。</li> : null}
        </ul>
        {validationState === 'ready' ? blockers.length > 0 ? <Notice tone="warn">このままでは公開できません：{blockers.map((check) => check.detail || check.label).join('・')}</Notice> : <p className="text-success mt-2 text-xs">必要なものは揃っています。</p> : null}
        <div className="mt-3 flex flex-wrap gap-2"><Button disabled={!canEdit || publishing || testing} onClick={onTestNotifications}>通知のテストを送る</Button><Button disabled={!canEdit || publishing || testing} busy={testing} busyLabel="確認中…" onClick={() => void testPublicPage()}>ページをテスト</Button></div>
        {testNotice ? <p className="text-ink-secondary mt-2 text-xs" role="status">{testNotice}</p> : null}
        {publishError ? <p className="text-danger mt-2 text-xs" role="alert">{publishError}</p> : null}
      </section>
      <section className="border-hairline bg-canvas rounded-card border p-4" aria-label="設定のまとめ"><h2 className="text-ink text-base font-semibold">設定のまとめ</h2><dl className="divide-hairline mt-3 divide-y">{rows.map(([label, value]) => <div key={label} className="flex items-baseline justify-between gap-4 py-3 text-xs"><dt className="text-ink-faint shrink-0">{label}</dt><dd className="text-ink min-w-0 text-right">{value}</dd></div>)}</dl></section>
    </div>
    <aside aria-label="公開ページでの見え方">
      <h2 className="text-ink text-base font-semibold">公開ページでの見え方</h2>
      <p className="text-ink mt-3 truncate text-sm" title={webinar.title}>{webinar.title}</p>
      <p className="text-ink-secondary mt-3 text-xs">{reviewTestSummaryBody(validation, validationState)}</p>
      <p className="text-ink-faint mt-3 text-xs">{reviewMonitoringText(monitoringFailures)}・{registrations === null ? '申込人数—' : `申込人数 ${formatNumber(registrations)}人`}</p>
      {canOpenPublicPage && publicUrl ? <Button className="mt-3" href={publicUrl} target="_blank" rel="noreferrer">公開ページを見る</Button> : <p className="text-ink-faint mt-3 text-xs">{publicPageReason || '公開すると、友だちが見るページを確認できます。'}</p>}
    </aside>
    <StickyBar actions={<><Button href="/webinars">キャンセル</Button>{onBack ? <Button onClick={onBack} disabled={publishing || testing}>通知へ戻る</Button> : null}<Button variant="primary" disabled={!canPublish} busy={publishing} busyLabel="公開中…" onClick={() => void publish()}>この版を公開</Button></>} />
  </div>
}
