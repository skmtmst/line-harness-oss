'use client'

/*
 * ★V8 ウェビナーの編集（入口 app/webinars/edit/page.tsx。V8 のときだけここ）。
 *
 * 作る手順の5段（基本設定 → 動画 → CTA・フォーム → 通知 → 確認）は作る型（CreatePage）、
 * 公開後に見る3つ（参加者・分析・コメント演出）は詳細の頭＋タブで出す。
 * 絵：②動画 VWNaA・LPOe7／③CTA Q0Jrk・pvimJ／④通知 E7iAYs／⑤確認 XCUNf／
 *     参加者 uNsEy／分析 z2dgw／コメント演出 Omqd4。
 *
 * 読み込み・失敗の分け方・段の行き来（URL の pane）・離れる前の確かめ・
 * 1本の保存の帯は app/webinars/edit/page.tsx と同じ（BEHAVIOR.md）。
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import Button from '@/components/shared/button'
import TargetMissing from '@/components/shared/target-missing'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import {
  ApiError,
  webinarApi,
  type Webinar,
  type WebinarAnalytics,
  type WebinarCtaCard,
  type WebinarEditor,
} from '@/lib/api'
import { webinarLoadFailure, type WebinarLoadFailure } from '@/v8/webinars/helpers'
import { BackLink, WizardSteps } from './chrome'
import {
  PANE_KEYS,
  STEPS,
  nextStepOf,
  stepStateOf,
  webinarStatusLabel,
  type PaneKey,
  type StepKey,
} from './helpers'
import type { DetailChrome, EditContext, WizardChrome } from './types'
import ParticipantsPane from './participants'
import AnalyticsPane from './analytics'
import CommentsPane from './comments'
import BasicPane from './basic'
import VideoPane from './video'
import CtaPane from './cta'
import NotificationsPane from './notifications'
import ReviewPane from './review'

const STEP_KEYS = STEPS.map((step) => step.key) as readonly string[]
const DETAIL_KEYS = ['participants', 'analytics', 'comments'] as const

/* 段の題（作る型の題）。絵：VWNaA「動画と公開期間」・Q0Jrk「CTA・フォーム」・E7iAYs「通知と視聴後のこと」・XCUNf「公開の前に確かめる」。 */
const STEP_TITLE: Record<StepKey, string> = {
  basic: 'ウェビナーを編集',
  video: '動画と公開期間',
  cta: 'CTA・フォーム',
  notifications: '通知と視聴後のこと',
  review: '公開の前に確かめる',
}

/* 次へ進む押し口の文言。絵どおり行き先の名前。 */
const NEXT_LABEL: Record<StepKey, string | null> = {
  basic: '動画の設定へ',
  video: 'CTA・フォームへ',
  cta: '通知へ',
  notifications: '確認へ',
  review: null,
}

function normalizePane(value: string | null): PaneKey {
  if (value === 'actions') return 'notifications'
  if (value === 'preview') return 'review'
  return (PANE_KEYS as readonly string[]).includes(value ?? '') ? value as PaneKey : 'basic'
}

function EditInner() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const id = searchParams.get('id')
  usePageTitle('ウェビナー')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const { accounts, loading: accountsLoading } = useAccount()
  const role = useStaffRole()
  /* 役割の確認が済むまでは今までどおり出し、staff と分かったら変える操作を隠す（最後の守りはサーバの 403）。 */
  const readOnly = role !== null && !canManageRole(role)

  const [loaded, setLoaded] = useState<{ id: string; webinar: Webinar; editor: WebinarEditor } | null>(null)
  const [loadFailure, setLoadFailure] = useState<{ id: string; failure: WebinarLoadFailure } | null>(null)
  const [loadMissing, setLoadMissing] = useState<{ id: string } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const loadRequestId = useRef(0)
  const [analytics, setAnalytics] = useState<WebinarAnalytics | null>(null)
  const [analyticsState, setAnalyticsState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [analyticsId, setAnalyticsId] = useState<string | null>(null)

  const webinar = loaded && loaded.id === id ? loaded.webinar : null
  const editor = loaded && loaded.id === id ? loaded.editor : null
  const loadError = loadFailure && loadFailure.id === id ? loadFailure.failure : null
  const missingNow = loadMissing !== null && loadMissing.id === id
  const loading = webinar === null && loadError === null && !missingNow

  const setEditor = useCallback((next: WebinarEditor) => {
    setLoaded((prev) => (prev && prev.id === id ? { ...prev, editor: next } : prev))
  }, [id])
  const handleWebinarSaved = useCallback((next: Webinar) => {
    setLoaded((prev) => (prev && prev.id === id ? { ...prev, webinar: next } : prev))
  }, [id])

  const initialPane = normalizePane(searchParams.get('pane'))
  const [pane, setPane] = useState<PaneKey>(initialPane)
  const [visited, setVisited] = useState<ReadonlySet<PaneKey>>(() => new Set([initialPane]))

  const [reportedCta, setReportedCta] = useState<{ webinarId: string; count: number } | null>(null)
  const ctaCount = reportedCta && reportedCta.webinarId === id ? reportedCta.count : (editor?.ctaCount ?? 0)
  const handleCtasReport = useCallback((ctas: WebinarCtaCard[] | null) => {
    setReportedCta({ webinarId: id ?? '', count: ctas?.length ?? 0 })
  }, [id])

  /* 段を行き来しても入力を消さない：一度開いた段は隠すだけ。保存と未保存の報告は段ごとに親へ登録する。 */
  const [savable, setSavable] = useState<ReadonlySet<PaneKey>>(new Set())
  const [unsaved, setUnsaved] = useState<ReadonlySet<PaneKey>>(new Set())
  const saveHandlers = useRef(new Map<PaneKey, () => Promise<boolean>>())
  const dirtyReporters = useRef(new Map<PaneKey, (dirty: boolean) => void>())
  const saveRegistrars = useRef(new Map<PaneKey, (save: (() => Promise<boolean>) | null) => void>())
  const [savingForNav, setSavingForNav] = useState<false | 'draft' | 'next'>(false)

  const dirtyReporterFor = (key: PaneKey): ((dirty: boolean) => void) => {
    let reporter = dirtyReporters.current.get(key)
    if (!reporter) {
      reporter = (dirty: boolean) => {
        setUnsaved((prev) => {
          if (prev.has(key) === dirty) return prev
          const next = new Set(prev)
          if (dirty) next.add(key)
          else next.delete(key)
          return next
        })
      }
      dirtyReporters.current.set(key, reporter)
    }
    return reporter
  }
  const saveRegistrarFor = (key: PaneKey): ((save: (() => Promise<boolean>) | null) => void) => {
    let registrar = saveRegistrars.current.get(key)
    if (!registrar) {
      registrar = (save) => {
        if (save) saveHandlers.current.set(key, save)
        else saveHandlers.current.delete(key)
        setSavable((prev) => {
          const has = save !== null
          if (prev.has(key) === has) return prev
          const next = new Set(prev)
          if (has) next.add(key)
          else next.delete(key)
          return next
        })
      }
      saveRegistrars.current.set(key, registrar)
    }
    return registrar
  }

  const { leaveTarget, confirmLeave, cancelLeave, disarm } = useUnsavedGuard({
    dirty: unsaved.size > 0,
    busy: savingForNav !== false,
    samePage: (destination) => destination.pathname === pathname && destination.searchParams.get('id') === id,
  })
  const leaveDialog = <UnsavedLeaveDialog open={leaveTarget !== null} subject="ウェビナーの変更" onConfirm={confirmLeave} onCancel={cancelLeave} />

  const goStep = useCallback((next: PaneKey) => {
    setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)))
    setPane(next)
    try {
      window.history?.pushState?.(null, '', `?id=${encodeURIComponent(id ?? '')}&pane=${next}`)
    } catch {
      /* 履歴を持たない環境（試験用の簡易DOM）では画面内の状態だけで動く。 */
    }
  }, [id])

  useEffect(() => {
    const onPop = () => {
      const next = normalizePane(new URLSearchParams(window.location.search).get('pane'))
      setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)))
      setPane(next)
    }
    window.addEventListener?.('popstate', onPop)
    return () => window.removeEventListener?.('popstate', onPop)
  }, [])

  useEffect(() => {
    if (!id) return
    const requestId = ++loadRequestId.current
    setAnalytics(null)
    setAnalyticsId(null)
    setAnalyticsState('idle')
    Promise.all([webinarApi.get(id), webinarApi.editor(id)])
      .then(([webinarResponse, editorResponse]) => {
        if (requestId !== loadRequestId.current) return
        setLoadFailure(null)
        setLoadMissing(null)
        setLoaded({ id, webinar: webinarResponse.data, editor: editorResponse.data })
      })
      .catch((err) => {
        if (requestId !== loadRequestId.current) return
        if (err instanceof ApiError && err.status === 404) {
          setLoadFailure(null)
          setLoadMissing({ id })
        } else {
          setLoadMissing(null)
          setLoadFailure({ id, failure: webinarLoadFailure(err) })
        }
      })
    return () => { loadRequestId.current += 1 }
  }, [id, reloadKey])

  /*
    集計は重い口。公開後に見る3つ（参加者・分析・コメント演出：タブの「参加者 124」）を開いたときだけ取り、
    戻ってきても取り直さない。失敗は段を離れたら捨て、次に開いたときに取り直す。
  */
  const isDetailPane = (DETAIL_KEYS as readonly string[]).includes(pane)
  useEffect(() => {
    if (!id) return
    if (!isDetailPane) {
      if (analyticsState === 'error') {
        setAnalytics(null)
        setAnalyticsId(null)
        setAnalyticsState('idle')
      }
      return
    }
    if (analyticsId === id && analyticsState !== 'idle') return
    let cancelled = false
    setAnalyticsState('loading')
    webinarApi.analytics(id)
      .then((response) => {
        if (cancelled) return
        setAnalytics(response.data)
        setAnalyticsId(id)
        setAnalyticsState('ready')
      })
      .catch(() => {
        if (cancelled) return
        setAnalytics(null)
        setAnalyticsId(id)
        setAnalyticsState('error')
      })
    return () => { cancelled = true }
  }, [id, isDetailPane, analyticsId, analyticsState])

  if (!id) {
    return <>
      <TargetMissing kind="unspecified" title="編集するウェビナーが指定されていません" description="一覧から編集するウェビナーを選び直してください。" backHref="/webinars" backLabel="ウェビナー一覧へ戻る" />
      {leaveDialog}
    </>
  }
  if (loading) {
    return <><p className="text-ink-faint p-6 text-sm" role="status">読み込み中...</p>{leaveDialog}</>
  }
  if (missingNow || (!loadError && (!webinar || !editor))) {
    return <>
      <TargetMissing kind="not-found" title="このウェビナーは見つかりません" description="削除されたか、別の LINE アカウントのものです。一覧から選び直してください。" backHref="/webinars" backLabel="ウェビナー一覧へ戻る" />
      {leaveDialog}
    </>
  }
  if (loadError || !webinar || !editor) {
    return <>
      <TargetMissing
        kind="error"
        title={loadError?.title ?? 'ウェビナーを読み込めませんでした'}
        description={loadError?.description ?? '通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。'}
        {...(loadError === null || loadError.retryable ? { onRetry: () => setReloadKey((key) => key + 1) } : {})}
      />
      {leaveDialog}
    </>
  }

  const account = webinar.accountId ? accounts.find((item) => item.id === webinar.accountId) : null
  const publicUrl = editor.publicPage.url
  const publicPageReason = accountsLoading
    ? 'LINE公式アカウントを確認しています。'
    : !webinar.accountId || !account
      ? 'このウェビナーのLINE公式アカウントを確認できません。'
      : !account.liffId
        ? 'LINE公式アカウントにLIFF IDが設定されていません。'
        : webinar.status !== 'active'
          ? '公開すると、友だちが見るページを確認できます。'
          : ''
  const canOpenPublicPage = webinar.status === 'active' && publicUrl !== null

  const ctx: EditContext = {
    webinar,
    editor,
    readOnly,
    publicUrl,
    canOpenPublicPage,
    publicPageReason,
    ctaCount,
    analytics,
    analyticsState,
    onEditorChange: setEditor,
    onWebinarSaved: handleWebinarSaved,
    onCtasReport: handleCtasReport,
    onPublished: disarm,
    goStep,
    retryAnalytics: () => { setAnalytics(null); setAnalyticsId(null); setAnalyticsState('idle') },
  }

  const stepPane: StepKey = (STEP_KEYS.includes(pane) ? pane : 'basic') as StepKey
  const stateOf = (key: StepKey) => {
    const state = stepStateOf(key, stepPane, webinar, ctaCount)
    /* 通知は、後ろの段（確認）にいるときは通った印にする（絵 XCUNf）。 */
    if (state === 'todo' && key === 'notifications' && stepPane === 'review') return 'done' as const
    return state
  }

  const runSave = async (key: PaneKey): Promise<boolean> => {
    const save = saveHandlers.current.get(key)
    return save ? save() : true
  }
  const handleDraftSave = async (key: PaneKey) => {
    if (savingForNav !== false) return
    setSavingForNav('draft')
    try { await runSave(key) } finally { setSavingForNav(false) }
  }
  const handleNext = async (key: StepKey) => {
    const next = nextStepOf(key)
    if (next === null || savingForNav !== false) return
    if (unsaved.has(key) && saveHandlers.current.has(key)) {
      setSavingForNav('next')
      try {
        if (!(await runSave(key))) return
      } finally {
        setSavingForNav(false)
      }
    }
    goStep(next)
  }

  const wizardChrome = (key: StepKey, primary?: ReactNode): WizardChrome => {
    const nextLabel = NEXT_LABEL[key]
    const label = nextLabel && unsaved.has(key) && savable.has(key) ? `保存して${nextLabel}` : nextLabel
    return {
      title: STEP_TITLE[key],
      identity: <BackLink />,
      steps: <WizardSteps current={key} stateOf={stateOf} onSelect={goStep} />,
      status: unsaved.size > 0 ? '保存していない変更があります' : undefined,
      footerActions: <>
        <Button href="/webinars">キャンセル</Button>
        {readOnly ? null : (
          <Button
            disabled={savingForNav !== false || !savable.has(key)}
            title={savable.has(key) ? undefined : 'この段に保存する変更はありません'}
            onClick={() => void handleDraftSave(key)}
            busy={savingForNav === 'draft'}
          >
            下書きを保存
          </Button>
        )}
        {primary ?? (label ? (
          <Button variant="primary" disabled={savingForNav !== false} onClick={() => void handleNext(key)} busy={savingForNav === 'next'}>
            <ArrowRight size={15} aria-hidden="true" />{label}
          </Button>
        ) : null)}
      </>,
    }
  }

  const detailChrome: DetailChrome = {
    title: webinar.title,
    subtitle: `${editor.deliveryKind === 'on_demand' ? 'オンデマンド・いつでも視聴' : '日時指定'}・${webinarStatusLabel(webinar.status)}（版 ${editor.version}）`,
    participantsCount: analytics ? analytics.summary.reservations : null,
    onSelect: goStep,
  }

  const keep = (key: PaneKey, node: ReactNode) => (visited.has(key) ? <div key={key} hidden={pane !== key}>{node}</div> : null)

  return (
    <div className="min-w-0" data-wc-editor="v8">
      {keep('basic', <BasicPane ctx={ctx} chrome={wizardChrome('basic')} onDirtyChange={dirtyReporterFor('basic')} registerSave={saveRegistrarFor('basic')} />)}
      {keep('video', <VideoPane ctx={ctx} chrome={wizardChrome('video')} onDirtyChange={dirtyReporterFor('video')} registerSave={saveRegistrarFor('video')} />)}
      {keep('cta', <CtaPane ctx={ctx} chrome={wizardChrome('cta')} onDirtyChange={dirtyReporterFor('cta')} registerSave={saveRegistrarFor('cta')} />)}
      {keep('notifications', <NotificationsPane ctx={ctx} chrome={wizardChrome('notifications')} onDirtyChange={dirtyReporterFor('notifications')} registerSave={saveRegistrarFor('notifications')} />)}
      {pane === 'review' ? <ReviewPane ctx={ctx} chromeFor={(primary) => wizardChrome('review', primary)} /> : null}
      {pane === 'participants' ? <ParticipantsPane ctx={ctx} chrome={detailChrome} /> : null}
      {pane === 'analytics' ? <AnalyticsPane ctx={ctx} chrome={detailChrome} /> : null}
      {keep('comments', <CommentsPane ctx={ctx} chrome={detailChrome} onDirtyChange={dirtyReporterFor('comments')} registerSave={saveRegistrarFor('comments')} />)}
      {leaveDialog}
    </div>
  )
}

export default function WebinarEditV8() {
  return (
    <Suspense fallback={<p className="text-ink-faint p-6 text-sm" role="status">読み込み中...</p>}>
      <EditInner />
    </Suspense>
  )
}
