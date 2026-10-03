'use client'

/*
 * ★V8-B ウェビナー編集⑤確認（板 `XCUNf`）。
 *
 * v7 の編集画面（`page.tsx` の `ReviewStep`）と同じ中身。
 * v7 側は触らず、こちらの段から使う。公開前検査・最終確認・公開を持つ。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import { webinarApi, type Webinar, type WebinarEditor, type WebinarPublishValidation } from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'
import { publicationStateLabel } from '@/components/webinars/publication-label'
import { webinarErrorText } from '@/components/webinars/webinar-error-text'
import { publishBlockers, type StepKey } from './edit-steps'
import { reviewActionSummaryText, reviewMonitoringText, reviewTestSummaryBody } from './review-text'
import { SummaryAside } from './edit-v8-shared'
import styles from './review-v8.module.css'

type WebinarWithPublication = Webinar & {
  publicationState?: 'period' | 'always' | 'scheduled' | 'ended' | 'unset' | null
  publicationStartsAt?: string | null
  publicationEndsAt?: string | null
}

function deliveryWindow(webinar: Webinar): string {
  /* 5枝の決まりは共有(`components/webinars/publication-label`)。ここは編集画面だけの落としどころ。 */
  const publication = webinar as WebinarWithPublication
  const shared = publicationStateLabel(publication.publicationState, publication.publicationStartsAt, publication.publicationEndsAt)
  if (shared !== null) return shared
  const daily = webinar.schedule.find((rule) => rule.type === 'daily' && rule.time)
  const once = webinar.schedule.find((rule) => rule.type === 'once' && rule.at)
  if (once?.at) return formatDateTime(Math.floor(new Date(once.at).getTime() / 1000) * 1000)
  if (daily?.time) return `毎日 ${daily.time}`
  return '—（公開期間は未設定）'
}

export default function ReviewStepV8({ webinar, editor, registrations, ctaCount, onBack, onPublished }: {
  webinar: Webinar
  editor: WebinarEditor
  registrations: number | null
  ctaCount: number
  onBack: (key: StepKey) => void
  onPublished: () => void
}) {
  const [validation, setValidation] = useState<WebinarPublishValidation | null>(null)
  const [validationState, setValidationState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState('')
  const validationRequestId = useRef(0)
  /*
    検査の取得に失敗しても「読み込み中」のまま公開ボタンを固めない。
    失敗は失敗と出して、やり直しと次の一手を添える。
  */
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
    return () => { validationRequestId.current += 1 }
  }, [loadValidation])
  const blockers = validation
    ? validation.checks.filter((check) => check.status === 'failed').map((check) => check.detail || check.label)
    : publishBlockers(webinar)
  /*
    R93: 最終確認と設定サマリーの文言は値に連動させる。
    検査の有無・合否と関係ない固定文（「確認しました」「追加」）は出さない。
  */
  const actionSummary = reviewActionSummaryText(validation)
  const testSummaryBody = reviewTestSummaryBody(validation, validationState)
  const monitoringFailures = editor.monitoring.notificationFailures +
    editor.monitoring.viewSegmentFailures + editor.monitoring.actionFailures
  const monitoringSummary = reviewMonitoringText(monitoringFailures)
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
  return (
    <div className={styles.body}>
      <div className="min-w-0 flex-1 space-y-3">
      <section className="border-hairline bg-canvas space-y-4 rounded-card border p-5 shadow-card">
      <div><h2 className="text-ink font-bold">公開前チェック</h2><p className="text-ink-faint mt-1 text-xs">公開に必要な設定を確認します。</p></div>
      {validationState === 'ready' && blockers.length > 0 ? (
        <Notice tone="warn">
          <p className="font-bold">このままでは公開できません。</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            {blockers.map((text) => <li key={text}>{text}</li>)}
          </ul>
        </Notice>
      ) : validationState === 'ready' ? (
        <Notice tone="success">
          必要なものは揃っています。
        </Notice>
      ) : null}
      <ul className="divide-hairline border-hairline divide-y rounded-card border text-sm">
        {(validation?.checks ?? []).map((check) => <li key={check.key} className="text-ink flex items-start gap-2 px-4 py-3"><span className={check.status === 'passed' ? 'text-success' : check.status === 'warning' ? 'text-warning' : 'text-danger'}>{check.status === 'passed' ? '✓' : '!'}</span><span><strong className="block">{check.label}</strong><span className="text-ink-faint text-xs">{check.detail}</span></span></li>)}
        {validationState === 'loading' ? <li className="text-ink-faint px-4 py-3">公開前検査を読み込んでいます。</li> : null}
      </ul>
      {validationState === 'error' ? (
        <Notice
          tone="danger"
          action={<Button onClick={loadValidation}>もう一度読み込む</Button>}
        >
          <p className="font-bold">公開前検査を読み込めませんでした。このままでは公開できません。</p>
          <p className="mt-1 text-xs">まず下のボタンでもう一度読み込んでください。直らなければ基本設定・動画・CTAの各段が保存済みか確かめ、時間をおいて開き直してください。</p>
        </Notice>
      ) : null}
      </section>
      <section className="border-hairline bg-canvas space-y-4 rounded-card border p-5 shadow-card">
      <div><h2 className="text-ink font-bold">最終確認</h2><p className="text-ink-faint mt-1 text-xs">公開すると、申込・配信条件に合う友だちが視聴できます。</p></div>
      <dl className="divide-hairline border-hairline divide-y rounded-card border">
        {[
          ['ウェビナー名', webinar.title || '未設定'],
          ['動画・公開', webinar.videoPrefix ? '申込者向け' : '未設定'],
          ['公開期間', deliveryWindow(webinar)],
          ['対象', registrations === null ? '—（未取得）' : `${formatNumber(registrations)}人`],
          ['CTA・フォーム', ctaCount > 0 ? `${ctaCount}件のCTA` : webinar.cta ? '動画＋CTA＋フォーム' : '未設定'],
          ['アクション', actionSummary],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
            <dt className="text-ink-faint text-xs font-semibold">{label}</dt>
            <dd className="text-ink text-sm">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onBack('basic')}>基本設定へ戻る</Button>
        <Button onClick={() => onBack('video')}>動画へ戻る</Button>
        <Button variant="primary" disabled={!validation || blockers.length > 0 || publishing} onClick={() => void publish()} busy={publishing} busyLabel="公開中…">この版を公開</Button>
      </div>
      {publishError ? <p className="text-danger text-xs" role="alert">{publishError}</p> : null}
      <p className="text-ink-faint text-xs">公開時点の版を固定し、編集中の下書きとは分けて保存します。</p>
      </section>
      </div>
      <SummaryAside rows={[
        ['状態', webinar.status === 'active' ? '公開中' : '有効化前'],
        ['申込見込み', registrations === null ? '—（未取得）' : `${formatNumber(registrations)}人`],
        ['通知重複', validation?.checks.find((check) => check.key === 'notification_duplicates')?.status === 'passed' ? '重複なし' : '要確認'],
        ['監視', monitoringSummary],
      ]} previewBody={testSummaryBody} previewFirst />
    </div>
  )
}
