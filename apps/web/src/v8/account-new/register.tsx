'use client'

import { canManageRole, useStaffRole } from '@/lib/staff-role'
import ReadOnlyNotice from '@/components/shared/read-only-notice'
import ListState from '@/components/shared/list-state'
import CopyTextButton from '@/components/shared/copy-text-button'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowLeft, ArrowRight, Check, CircleAlert, CircleDashed, Copy, Plug,
} from 'lucide-react'
import { api, type FollowerImportState, type LineAccountConnectData, type LineRegistrationReceipt } from '@/lib/api'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { PageContent, PageFrame, PageHeading } from '@/components/templates/page-frame'
import { StepContent } from '@/components/templates/steps'
import { CreateStepColumns } from '@/components/templates/create-step-columns'
import { Steps } from '@/components/templates/steps'
import StepUpPrompt, { isStepUpRequired, type StepUpRequest } from '@/components/step-up-prompt'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import StickyBar from '@/components/shared/sticky-bar'
import Checkbox from '@/components/shared/checkbox'
import Notice from '@/components/shared/notice'
import NoticeLineRegisterDialog from '@/components/hq/notice-line-register-dialog'
import {
  DRAFT_KEY, LOGIN_ACKS, WEBHOOK_ACKS, allAcked, allV06RowsOk, channelErrors, checkActionLabel, checkErrorText,
  checkStage, formatJaDuration, handoverProgress, insightDateJst, isDuplicateChannelError,
  loginChannelErrors, matchRegisteredAccountId, messagingApiErrors, nextCursor, readDraft, stepLabel, subTotal,
  toV06CheckRows,
  precheckBack, precheckBlocked, precheckNext, precheckNote, precheckStateLabel, precheckSummary, precheckUpcoming,
  type DraftState, type PrecheckAnswers, type PrecheckAt, type PrecheckKey, type StepNumber,
} from './logic'
import Step1Precheck from './step1-precheck'
import Step2Connect from './step2-connect'
import Step4Template from './step4-template'
import Step5Completion from './step5-completion'
import ResumeRegistrationStyle from './resume-style'
import { REGISTRATION_STYLE_KEY, useRegistrationStyle } from './use-registration-style'
import styles from './register.module.css'
import { qrToDataURL } from '@/lib/qr-image'
import TruncatedText from '@/components/shared/truncated-text'
import { emptyValue } from '@/components/shared/empty-value'
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'
import { describeActionFailure } from '@/lib/use-action-error'

/*
 * ★v07 LINEアカウントを登録（板 ①p6zMkA ②Fqy29 ③Lwxyh ④X0pGdw ⑤Plmq1）。
 * 絵の正本は利用者承認済みの LINE新規追加_v07.pen（2026-10-18 承認）。
 * ②の小さな段は正本どおり Messaging API → Webhook の設定 → LINE Login の順。
 * 段の中身・使う口・端末の下書きなど、動きの一覧は同じ場所の BEHAVIOR.md。
 */

const V8_STEPS: ReadonlyArray<{ number: StepNumber; label: string; node: string; lead: string }> = [
  { number: 1, label: '事前確認', node: 'p6zMkA', lead: 'LINE公式アカウントと2つのチャネルを用意します。接続確認が通るまで、アカウントは作られません。' },
  { number: 2, label: 'アカウント接続', node: 'Fqy29', lead: 'LINE Developers の画面からコピーして貼り付けます。秘密値は保存後に画面へ表示されません。' },
  { number: 3, label: '接続確認', node: 'Lwxyh', lead: '5つの確認がすべて通ってから登録します。そのあと自分のスマホで友だち追加を試します。' },
  { number: 4, label: '使い方を選ぶ', node: 'X0pGdw', lead: 'いちばん近い使い方を選びます。あとから変えられます。' },
  { number: 5, label: '完了', node: 'Plmq1', lead: 'いまの友だちを引き継いでいます。終わると完了です。' },
]

type BusyAction = 'check' | 'save' | null
interface FormState {
  name: string; channelId: string; channelSecret: string; loginChannelId: string; loginChannelSecret: string
  lineId: string; tagIds: string[]; parentId: string; staffIds: string[]; liffId: string; importFriends: boolean
}
const emptyForm: FormState = {
  name: '', channelId: '', channelSecret: '', loginChannelId: '', loginChannelSecret: '',
  lineId: '', tagIds: [], parentId: '', staffIds: [], liffId: '', importFriends: true,
}

export default function AccountRegisterV8() {
  const role = useStaffRole()
  const [resumeId, setResumeId] = useState('')
  useEffect(() => {
    if (!canManageRole(role)) return
    try { setResumeId(sessionStorage.getItem(REGISTRATION_STYLE_KEY) ?? '') } catch { /* 接続を新規作成する前に通常の重複検査も行う。 */ }
  }, [role])
  usePageTitle('LINEアカウントを登録')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: 'アカウント', href: '/hq' }])

  // API の接続・登録と同じくオーナー・管理者だけ。権限確認前に下書きの復元や変更処理を起動しない。
  if (!canManageRole(role)) return <PageFrame kind="wizard" boardId="p6zMkA">
    <PageHeading title="LINEアカウントを登録" />
    <PageContent layout="stats">{role === null ? <ListState kind="loading" title="権限を確認しています" /> : <ReadOnlyNotice>LINEアカウントの登録はオーナーか管理者ができます。オーナーか管理者に頼んでください。</ReadOnlyNotice>}</PageContent>
    <StickyBar actions={<Button variant="secondary" href="/accounts">LINEアカウントの一覧へ戻る</Button>} />
  </PageFrame>
  if (resumeId) return <ResumeRegistrationStyle accountId={resumeId} />
  return <AccountRegistrationForm />
}

function AccountRegistrationForm() {
  const saveErrors = useSaveFormErrors()

  // ①事前確認（v07 p6zMkA）。答えと、いま出している面。
  const [precheck, setPrecheck] = useState<PrecheckAnswers>({})
  const [precheckAt, setPrecheckAt] = useState<PrecheckAt>('q1')
  const [currentStep, setCurrentStep] = useState<StepNumber>(1)
  const [sub, setSub] = useState(1)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [acks, setAcks] = useState<Record<string, boolean>>({})
  const [connection, setConnection] = useState<LineAccountConnectData | null>(null)
  const [importState, setImportState] = useState<FollowerImportState | null>(null)
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [recoveredAccountId, setRecoveredAccountId] = useState('')
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  const [checkCursor, setCheckCursor] = useState(0)
  const [checkRunning, setCheckRunning] = useState(false)
  const [checkAttempted, setCheckAttempted] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [receipt, setReceipt] = useState<LineRegistrationReceipt>({ status: 'waiting', receivedAt: null })
  const [receiptRequestFailed, setReceiptRequestFailed] = useState(false)
  const [receiptChecking, setReceiptChecking] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [insightTotal, setInsightTotal] = useState<number | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)
  const [noticeDialog, setNoticeDialog] = useState<'idle' | 'open' | 'done'>('idle')
  const busyLock = useRef(false)
  const stepPanelRef = useRef<HTMLDivElement>(null)

  const checkRows = toV06CheckRows(connection, { running: checkRunning, cursor: checkCursor })
  const rowsOk = allV06RowsOk(checkRows)
  const checkNotice = checkErrorText(checkStage(connection, checkRunning), checkRows)
  const badge = currentStep === 1 ? precheckStateLabel(precheckAt) : stepLabel(currentStep, sub)
  // 「公式アカウントをこれから作る人」は Q1=いいえ の人。下書きの持ち方は v05 までと同じにしておく。
  const accountMethod: 'existing' | 'new' = precheck.q1 === 'no' ? 'new' : 'existing'
  const precheckRows = precheckSummary(precheckAt, precheck)
  const precheckAhead = precheckUpcoming(precheckAt, precheck)
  const precheckGuide = precheckNote(precheckAt, precheck)
  // 答えを1つ入れ替える。キーは PrecheckKey なので、まとめて組み直してから渡す。
  const answerPrecheck = (key: PrecheckKey, value: string) => {
    setPrecheck((current) => ({ ...current, [key]: value }) as PrecheckAnswers)
    setError('')
  }
  const createdId = connection?.id ?? ''
  // Webhook URLは②Step2で表示する。Callback URLは入力させない。
  const registrationStyle = useRegistrationStyle(createdId, currentStep === 4)
  const templateKey = registrationStyle.choice
  const importPhase = importState?.phase ?? connection?.followerImport.phase ?? ''
  const importRunning = importPhase === 'importing_ids' || importPhase === 'hydrating_profiles'
  const basicId = connection?.basicId ?? ''
  const addFriendUrl = basicId ? `https://line.me/R/ti/p/${encodeURIComponent(basicId.startsWith('@') ? basicId : `@${basicId}`)}` : ''
  const shownStep = V8_STEPS[currentStep - 1]

  useEffect(() => { stepPanelRef.current?.focus() }, [currentStep, sub, precheckAt])
  useEffect(() => {
    if (!Object.keys(fieldErrors).length) return
    const invalid = stepPanelRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')
    invalid?.focus()
    invalid?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [fieldErrors, currentStep, sub])

  // 端末の下書きがあれば一度だけ戻す（秘密値は書いていないので入れ直す）。
  useEffect(() => {
    const draft = (() => { try { return readDraft(window.localStorage) } catch (saveFailure) {
      saveErrors.capture(saveFailure)
      return null } })()

    if (!draft) return
    setPrecheck(draft.precheck)
    setPrecheckAt(draft.precheckAt)
    setCurrentStep(draft.step)
    setSub(draft.sub)
    setForm((current) => ({
      ...current, name: draft.name, channelId: draft.channelId, loginChannelId: draft.loginChannelId, lineId: draft.lineId,
      tagIds: draft.tagIds, parentId: draft.parentId, staffIds: draft.staffIds, liffId: draft.liffId, importFriends: draft.importFriends,
    }))
    setDraftRestored(true)
  }, [saveErrors])

  // 変わるたびに端末の下書きを残す（秘密値は除く）。登録が終わったら消す。
  useEffect(() => {
    if (createdId) {
      try { window.localStorage.removeItem(DRAFT_KEY) } catch (saveFailure) {
        saveErrors.capture(saveFailure) /* 消せなくても登録は続ける。 */ }
      return
    }
    const draft: DraftState = {
      step: currentStep, sub, accountMethod, precheck, precheckAt,
      name: form.name, channelId: form.channelId, loginChannelId: form.loginChannelId,
      lineId: form.lineId, tagIds: form.tagIds, parentId: form.parentId, staffIds: form.staffIds, liffId: form.liffId,
      importFriends: form.importFriends,
    }
    try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)) } catch (saveFailure) {
      saveErrors.capture(saveFailure) /* 書けなくても入力は続ける。 */ }
  }, [createdId, currentStep, sub, accountMethod, precheck, precheckAt, form.name, form.channelId, form.loginChannelId, form.lineId, form.tagIds, form.parentId, form.staffIds, form.liffId, form.importFriends, saveErrors])

  /* ③-1：応答が返ったあと、5行を1行ずつ送る。止まった行（error）が出たらそこで終わる。 */
  useEffect(() => {
    if (!checkRunning || !connection) return
    const rows = toV06CheckRows(connection, { running: true, cursor: checkCursor })
    const next = nextCursor(rows, checkCursor)
    if (next === null) { setCheckRunning(false); return }
    const timer = setTimeout(() => setCheckCursor(next), 420)
    return () => clearTimeout(timer)
  }, [checkRunning, connection, checkCursor])

  // ③-2：自分のスマホで読む友だち追加のQR。作れなくてもURLは出す。
  useEffect(() => {
    if (currentStep !== 3 || sub !== 2 || !addFriendUrl) return
    let cancelled = false
    void (async () => {
      try {
        const dataUrl = await qrToDataURL(addFriendUrl, { width: 220, margin: 1 })
        if (!cancelled) setQrDataUrl(dataUrl)
      } catch (saveFailure) {
        saveErrors.capture(saveFailure) /* QRが出なくてもURLから追加できる。 */ }
    })()
    return () => { cancelled = true }
  }, [currentStep, sub, addFriendUrl, saveErrors])

  // ③-2：人数ではなく、このアカウントに登録後届いた署名付きWebhookの記録を確認する。
  useEffect(() => {
    if (currentStep !== 3 || sub !== 2 || !createdId || (receipt.status === 'confirmed' && !receiptRequestFailed)) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const response = await api.lineAccounts.registrationReceipt(createdId)
        if (!active) return
        if (response.success) {
          setReceipt(response.data)
          setReceiptRequestFailed(false)
          if (response.data.status === 'confirmed') return
        } else setReceiptRequestFailed(true)
      } catch {
        if (active) setReceiptRequestFailed(true)
      }
      if (active) timer = setTimeout(() => void poll(), 5000)
    }
    void poll()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [currentStep, sub, createdId, receipt.status, receiptRequestFailed])

  /* ⑤：読み取りだけだと次の cron（5分ごと）まで進まないので、画面を開いている間は
   * 1 回ぶんが終わるたびに次を呼ぶ。閉じたあとは cron と「入る」が続きを拾う。 */
  useEffect(() => {
    if (!createdId || !importRunning || !form.importFriends) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const advance = async () => {
      try {
        const response = await api.lineAccounts.stepFollowerImport(createdId)
        if (!active || !response.success) return
        setImportState(response.data.state)
        if (['importing_ids', 'hydrating_profiles'].includes(response.data.state.phase)) {
          /* 進めた直後は待たない（0.5秒は、何も進まない応答が続いたときの空回り止め）。 */
          timer = setTimeout(() => void advance(), response.data.busy ? 3000 : 500)
        }
      } catch (saveFailure) {
        saveErrors.capture(saveFailure)
        if (active) timer = setTimeout(() => void advance(), 5000)
      }
    }
    void advance()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [createdId, importRunning, form.importFriends, saveErrors])

  // ⑤：引き継ぎの総数（前日の友だち数）。取れなければ引き継いだ数だけ出す。
  useEffect(() => {
    if (currentStep !== 5 || !createdId || insightTotal !== null) return
    let active = true
    void (async () => {
      try {
        const response = await api.lineAccounts.followerInsight(createdId, insightDateJst())
        if (active && response.success && typeof response.data.followers === 'number') setInsightTotal(response.data.followers)
      } catch (saveFailure) {
        saveErrors.capture(saveFailure) /* 総数が出なくても引き継いだ数は出す。 */ }
    })()
    return () => { active = false }
  }, [currentStep, createdId, insightTotal, saveErrors])

  // ⑤：引き継ぎ中だけ経過を数える（残り時間の見積りに使う）。
  useEffect(() => {
    if (currentStep !== 5 || !importRunning) return
    const timer = setInterval(() => setElapsed((current) => current + 1), 1000)
    return () => clearInterval(timer)
  }, [currentStep, importRunning])

  // 登録完了（引き継ぎも終わった）直後に契約者専用LINEの案内を一度だけ出す。
  useEffect(() => {
    if (currentStep === 5 && connection && !importRunning && noticeDialog === 'idle') setNoticeDialog('open')
  }, [currentStep, connection, importRunning, noticeDialog])

  const update = (key: keyof FormState, value: string | string[] | boolean) => {
    setForm((current) => ({ ...current, [key]: value } as FormState))
    setFieldErrors((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    if (key === 'channelId' || key === 'channelSecret' || key === 'loginChannelId' || key === 'loginChannelSecret') {
      setConnection(null)
      setCheckCursor(0)
      setCheckRunning(false)
      setCheckAttempted(false)
    }
    setError('')
    setRecoveredAccountId('')
  }

  const toggleAck = (key: string, next: boolean) => {
    setAcks((current) => ({ ...current, [key]: next }))
    setError('')
  }

  const input = () => ({
    name: form.name.trim() || undefined,
    channelId: form.channelId.trim(),
    channelSecret: form.channelSecret,
    loginChannelId: form.loginChannelId.trim(),
    loginChannelSecret: form.loginChannelSecret,
    tagIds: form.tagIds, staffIds: form.staffIds, parentLineAccountId: form.parentId || null,
    ...(form.liffId.trim() ? { liffId: form.liffId.trim() } : {}),
  })

  /* R523: 同じチャネルIDで作られた行が残っていないか照合する。取れなければ null（未保存と断定しない）。 */
  const findRegisteredAccountId = async (channelId: string): Promise<string | null> => {
    try {
      const list = await api.lineAccounts.list()
      if (!list.success) return null
      return matchRegisteredAccountId(list.data, channelId)
    } catch (saveFailure) {
      saveErrors.capture(saveFailure)
      return null
    }
  }

  // ③-1「接続を確かめる」：4項目でLINEへ問い合わせ、5行を1行ずつ送る。
  const runCheck = async () => {
    const nextErrors = channelErrors(form)
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors((current) => ({ ...current, ...nextErrors }))
      setCurrentStep(2)
      setSub(1)
      setError('')
      return
    }
    if (busyLock.current) return
    busyLock.current = true
    setBusyAction('check')
    setConnection(null)
    setCheckCursor(0)
    setCheckRunning(true)
    setCheckAttempted(true)
    setError('')
    try {
      const response = await api.lineAccounts.connectCheck(input())
      if (!response.success) {
        setCheckRunning(false)
        setError(response.error)
        return
      }
      setConnection(response.data)
      setReceipt({ status: 'waiting', receivedAt: null })
      setReceiptRequestFailed(false)
      if (response.data.basicId) setForm((current) => ({ ...current, lineId: response.data.basicId ?? current.lineId }))
      // 止まった行は③の一覧が赤で示し、下の帯が「どこを直すか」を言う。同じ文を重ねない。
    } catch (saveFailure) {
      setCheckRunning(false)
      const fieldFailure = saveErrors.capture(saveFailure)
      /* 「時間をおいて」の一文に畳むと、権限不足の人が待ち続け、混み合いの人が連打する。
         403・404・429・入力の直しは原因どおりに言い分ける（共通の describeActionFailure）。
         登録・接続確認はオーナーと管理者が行える。 */
      if (!fieldFailure) setError(describeActionFailure(saveFailure, '接続の確認'))
    } finally {
      busyLock.current = false
      setBusyAction(null)
    }
  }

  const save = async (stepUpToken?: string) => {
    if (!rowsOk || busyLock.current) {
      setError('5つの確認がすべて通ってから登録してください。')
      return
    }
    busyLock.current = true
    setBusyAction('save')
    setError('')
    setRecoveredAccountId('')
    try {
      const response = await api.lineAccounts.connect(input(), stepUpToken)
      if (!response.success) {
        // R523: 重複は登録済みの詳細へ案内する。
        if (isDuplicateChannelError(response.error)) {
          const recovered = await findRegisteredAccountId(form.channelId)
          if (recovered) {
            setRecoveredAccountId(recovered)
            setError('このチャネルIDは登録済みです。登録済みのアカウントを開いて確認してください。')
            return
          }
        }
        setError(response.error)
        return
      }
      setConnection(response.data)
      setForm((current) => ({ ...current, channelSecret: '', loginChannelSecret: '' }))
      try { if (response.data.id) sessionStorage.setItem(REGISTRATION_STYLE_KEY, response.data.id) } catch (failure) { saveErrors.capture(failure) }
      // v07：登録できたら③の2つめ（友だち追加のためし）へ進む。
      setCurrentStep(3)
      setSub(2)
    } catch (caught) {
      const fieldFailure = saveErrors.capture(caught)
      // LINEの接続は大事な操作。本人確認を求められたら窓を立ててやり直す。
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'line_account.connect', action: 'LINEの接続を登録する', retry: save })
        return
      }
      // R523: 応答が無い失敗は「未保存」と断定しない。
      const recovered = await findRegisteredAccountId(form.channelId)
      if (recovered) {
        setRecoveredAccountId(recovered)
        if (!fieldFailure) setError('保存は終わっている可能性があります。登録済みのアカウントを開いて確認してください。')
        return
      }
      if (!fieldFailure) setError('登録できませんでした。時間をおいて、もう一度お試しください。')
    } finally {
      busyLock.current = false
      setBusyAction(null)
    }
  }

  const moveNext = () => {
    setError('')
    if (currentStep === 1) {
      // ①は質問を1つずつ出す。最後の「チェック結果」まで来てから②へ渡す（v07 p6zMkA）。
      if (precheckAt !== 'done') {
        const nextAt = precheckNext(precheckAt, precheck)
        if (!nextAt) return
        setPrecheckAt(nextAt)
        return
      }
      setCurrentStep(2)
      setSub(1)
      return
    }
    if (currentStep === 2) {
      if (sub === 1) {
        const nextErrors = messagingApiErrors(form)
        if (Object.keys(nextErrors).length > 0) { setFieldErrors((current) => ({ ...current, ...nextErrors })); return }
        setSub(2)
        return
      }
      if (sub === 2) {
        if (!allAcked(WEBHOOK_ACKS, acks)) return
        setSub(3)
        return
      }
      const loginErrors = loginChannelErrors(form)
      if (Object.keys(loginErrors).length > 0) { setFieldErrors((current) => ({ ...current, ...loginErrors })); return }
      if (!allAcked(LOGIN_ACKS, acks)) return
      setCurrentStep(3)
      setSub(1)
      return
    }
    if (currentStep === 3) {
      if (sub === 1) {
        if (!rowsOk) return
        void save()
        return
      }
      if (receipt.status !== 'confirmed' || receiptChecking || !createdId) return
      // 表示済みの結果だけを信じず、押した時点でサーバの受信記録をもう一度確かめる。
      setReceiptChecking(true)
      void (async () => {
        try {
          const response = await api.lineAccounts.registrationReceipt(createdId)
          if (response.success) {
            setReceipt(response.data)
            setReceiptRequestFailed(false)
            if (response.data.status === 'confirmed') {
              setCurrentStep(4)
              setSub(1)
            }
          } else setReceiptRequestFailed(true)
        } catch {
          setReceiptRequestFailed(true)
        } finally {
          setReceiptChecking(false)
        }
      })()
      return
    }
    if (currentStep === 4) {
      void registrationStyle.save().then(saved => {
        if (saved) { setCurrentStep(5); setSub(1) }
      })
    }
  }

  const moveBack = () => {
    setError('')
    if (currentStep === 1) {
      // ①の中は答えた質問をさかのぼる。先頭の質問より手前には戻らない。
      const backAt = precheckBack(precheckAt, precheck)
      if (backAt) setPrecheckAt(backAt)
      return
    }
    if (sub > 1) { setSub(sub - 1); return }
    if (currentStep > 1) {
      const previous = (currentStep - 1) as StepNumber
      setCurrentStep(previous)
      setSub(Math.max(1, subTotal(previous)))
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    moveNext()
  }

  const handover = handoverProgress({
    imported: importState?.imported ?? 0,
    total: insightTotal,
    elapsedSeconds: elapsed,
    running: importRunning,
  })
  const remainText = handover.remainingSeconds ? `残り およそ ${formatJaDuration(handover.remainingSeconds)}` : '残り時間を計算しています'
  const busy = Boolean(busyAction) || registrationStyle.busy
  // 登録したあとは戻らない（③の2つめから先）。
  const canBack = !createdId && (currentStep > 1 || sub > 1 || (currentStep === 1 && precheckBack(precheckAt, precheck) !== null))
  const nextBlocked = (currentStep === 1 && precheckBlocked(precheckAt, precheck, acks))
    || (currentStep === 2 && sub === 2 && !allAcked(WEBHOOK_ACKS, acks))
    || (currentStep === 2 && sub === 3 && !allAcked(LOGIN_ACKS, acks))
    || (currentStep === 3 && sub === 1 && !rowsOk)
    || (currentStep === 3 && sub === 2 && (receipt.status !== 'confirmed' || receiptRequestFailed || receiptChecking))
    || (currentStep === 4 && (!templateKey || registrationStyle.version === null))
  // v07 Fqy29／Lwxyh：②の中だけ「次のステップへ」と行き先を名前で書いた「戻る」。ほかの段は「次へ」「戻る」。
  const backLabel = currentStep === 3 && sub === 1 ? 'LINEログインへ戻る'
    : currentStep !== 2 ? '戻る'
    : sub === 1 ? '事前確認へ戻る' : sub === 2 ? 'Messaging API へ戻る' : 'Webhook の設定へ戻る'
  const nextLabel = currentStep === 3 && sub === 1 ? '登録する' : currentStep === 2 ? '次のステップへ' : '次へ'

  return (
    <SaveErrorScope errors={saveErrors}><PageFrame kind="wizard" boardId={shownStep.node}>
      <PageHeading
        title="LINEアカウントを登録"
        help={shownStep.lead}
        /* ★承認済み v07 p6zMkA〜Plmq1：手順は題と説明の下の行・左寄せ（板の頭 KPoLr のあと、中身の先頭 t0FvCX）。共通の決まり Fa8ED と同じ。 */
        steps={(
          <Steps
            label="登録の進捗"
            summaries={{ '1': '事前確認済み', '2': 'LINEの接続設定を確認済み', '3': form.name.trim(), '4': templateKey ? ({ standard: '基本の使い方', ec: 'EC・通販', salon: 'サロン', restaurant: '飲食店', school: '教室' } as Record<string, string>)[templateKey] ?? '使い方を設定済み' : '' }}
            /* v07はアカウントを③で作るので、作ったあとも⑤へ飛ばさない。 */
            currentKey={String(currentStep)}
            steps={V8_STEPS.map((step) => ({
              key: String(step.number),
              label: step.label,
              order: step.number,
              state: currentStep > step.number ? 'done' as const : 'todo' as const,
              /* 登録する前は、済んだ段を押すとその段へ戻る（入れた値はそのまま）。登録した後は戻らない。 */
              onSelect: !createdId && currentStep > step.number ? () => { setCurrentStep(step.number); setSub(1) } : undefined,
            }))}
          />
        )}
      />
      <form className={styles.body} onSubmit={submit} noValidate aria-busy={busy || undefined}>
        <div ref={stepPanelRef} tabIndex={-1}><StepContent step={currentStep * 10 + sub} className={styles.stepBody}>
          {currentStep === 1 && (
            <Step1Precheck
              badge={badge}
              draftRestored={draftRestored}
              onCloseDraftNotice={() => setDraftRestored(false)}
              precheckAt={precheckAt}
              onJumpTo={(key) => { setPrecheckAt(key); setError('') }}
              precheck={precheck}
              onAnswer={answerPrecheck}
              rows={precheckRows}
              guide={precheckGuide}
              ahead={precheckAhead}
              acks={acks}
              onToggleAck={toggleAck}
            />
          )}

          {currentStep === 2 && (
            <Step2Connect
              sub={sub}
              badge={badge}
              values={form}
              fieldErrors={fieldErrors}
              acks={acks}
              onUpdate={update}
              onToggleAck={toggleAck}
            />
          )}

          {currentStep === 3 && sub === 1 && (
            <CreateStepColumns data-design-node="Lwxyh" previewTitle="ここで登録します" preview={(
                <Card className={styles.aside} layout="vertical" surface="muted" contentPadding="var(--tpl-htn-aside-pad)" gap="var(--tpl-htn-aside-gap)" aria-label="ここで登録します">
                <h2 className={styles.asideH2}>ここで登録します</h2>
                <p className={styles.asideP}>5つの確認がすべて通るまで、アカウントは作られません。</p>
                <p className={styles.asideP}>止まった項目を直して、もう一度「もう一度確かめる」を押します。</p>
              </Card>
              )}>
              <Card surface="standard" layout="vertical" contentPadding="var(--tpl-htn-panel-pad)" gap="var(--tpl-htn-panel-gap)" className={styles.panel} aria-label="接続確認">
                <p className={styles.subBadge}>{badge}</p>
                <h2 className={styles.panelTitle}>接続確認</h2>
                <ul className={styles.checkList}>
                  {checkRows.map((row) => (
                    <li key={row.key} className={styles.checkRow} data-phase={row.phase}>
                      <span className={styles.checkIcon}>
                        {row.phase === 'checking' ? <span className={styles.ring} />
                          : row.phase === 'ok' ? <Check size={16} aria-hidden="true" />
                          : row.phase === 'error' ? <CircleAlert size={16} aria-hidden="true" />
                          : <CircleDashed size={16} aria-hidden="true" />}
                      </span>
                      <span className={styles.checkTitle}>{row.title}</span>
                      <span className={styles.checkDetail}>{row.detail}</span>
                    </li>
                  ))}
                </ul>
                {checkNotice && (
                  <div className={checkNotice.tone === 'info' ? `${styles.errorBox} ${styles.errorBoxInfo}` : styles.errorBox} role={checkNotice.tone === 'danger' ? 'alert' : undefined}>
                    <p>{checkNotice.title}</p>
                    <p>{checkNotice.body}</p>
                  </div>
                )}
                <Card surface="inset" contentPadding="var(--polish-space-card)">
                  <SaveErrorField names={["importFriends","form.importFriends","import_friends","form.import_friends"]}><Checkbox checked={form.importFriends} onCheckedChange={(next) => update('importFriends', next)} description="登録のあと、いまの友だちを musubo に引き継ぎます（数分かかります）">いまの友だちの引き継ぎ</Checkbox></SaveErrorField>
                </Card>
              </Card>
            </CreateStepColumns>
          )}

          {currentStep === 3 && sub === 2 && connection && (
            <CreateStepColumns data-design-node="Lwxyh" previewTitle="ためしに友だち追加" preview={(
                <Card className={styles.aside} layout="vertical" surface="muted" contentPadding="var(--tpl-htn-aside-pad)" gap="var(--tpl-htn-aside-gap)" aria-label="ためしに友だち追加">
                <h2 className={styles.asideH2}>ためしに友だち追加</h2>
                <p className={styles.asideP}>まだ友だちでなければ、スマホの LINE で QR を読み取って追加してください。</p>
                <p className={styles.asideP}>すでに友だちなら、この公式アカウントとのトークに「接続テスト」と送ってください。受信が確認できると次へ進めます。</p>
              </Card>
              )}>
              <Card surface="standard" layout="vertical" contentPadding="var(--tpl-htn-panel-pad)" gap="var(--tpl-htn-panel-gap)" className={styles.panel} aria-label="ためしに友だち追加">
                <p className={styles.subBadge}>{badge}</p>
                <h2 className={styles.panelTitle}>友だち追加できるか確かめます</h2>
                <div className={styles.qrBlock}>
                  <div className={styles.qrFrame}>
                    {qrDataUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element -- QRはその場で作る data URL なので次の画像最適化は通らない。 */
                      <img src={qrDataUrl} alt="友だち追加のQRコード" width={220} height={220} />
                    ) : (
                      <p className={styles.qrWait}>QRを作っています…</p>
                    )}
                  </div>
                  <div className={styles.qrSide}>
                    <span className={styles.groupLabel}>友だち追加の窓口</span>
                    <Card layout="horizontal" surface="muted" corner="control" contentPadding="var(--space-8) var(--space-8) var(--space-8) var(--polish-space-card)" gap="var(--tpl-htn-panel-gap)">
                      <span className={styles.endpointValue} ><TruncatedText value={addFriendUrl || String(emptyValue('unknown'))} url /></span>
                      <CopyButton value={addFriendUrl || String(emptyValue('unknown'))} />
                    </Card>
                    <div className={`${styles.receiptState} ${(receiptRequestFailed || receipt.status === 'error') ? styles.receiptError : receipt.status === 'confirmed' ? styles.receiptSuccess : ''}`} role="status" aria-live="polite">
                      <p>{receiptRequestFailed ? '受信を確認できませんでした' : receipt.status === 'confirmed' ? '接続を確認できました' : receipt.status === 'error' ? '受信の確認に問題があります' : '接続を待っています…'}</p>
                      <p>{receiptRequestFailed
                        ? '通信の状態を確認しています。しばらく待っても変わらない場合は、画面を読み直してください。'
                        : receipt.status === 'confirmed'
                          ? 'このアカウントの友だち追加、またはテストメッセージを musubo で確認できました。「次へ」を押してください。'
                          : receipt.status === 'error'
                            ? '受信処理に失敗しました。設定を確認して再度お試しください。解消しない場合はサポートにお問い合わせください。'
                            : '友だち追加の通知が musubo に届くと、この画面が「接続を確認できました」に変わります。確認後に「次へ」を押してください。'}</p>
                    </div>
                    <div className={styles.receiptAccount}>
                      <span className={styles.receiptAccountIcon} aria-hidden="true">{(connection.displayName ?? form.name).slice(0, 1) || 'L'}</span>
                      <span><strong>{connection.displayName ?? form.name}</strong><br />{basicId || String(emptyValue('unknown'))}</span>
                    </div>
                    <div className={styles.receiptInstructions}>
                      <strong>すでに友だち追加している場合</strong>
                      <p>このアカウントの LINE トークから「接続テスト」と送ってください。QR を開き直すだけでは確認できません。</p>
                    </div>
                    <p className={styles.receiptHelp}>変わらない場合は LINE Developers で Webhook の利用がオンか確認してください。</p>
                    <p className={styles.receiptHelp}><a href="/hq/support">変わらない場合はサポートに問い合わせ</a></p>
                  </div>
                </div>
              </Card>
            </CreateStepColumns>
          )}

          {currentStep === 4 && (
            <>{registrationStyle.error ? <ListState kind="error" title="使い方を確認・保存できませんでした" error={registrationStyle.error} onRetry={registrationStyle.reload} /> : null}<Step4Template templateKey={templateKey} onPick={(key) => { registrationStyle.setChoice(key); setError('') }} /></>
          )}

          {currentStep === 5 && connection && (
            <Step5Completion connection={connection} accountName={form.name.trim()} createdId={createdId} importRunning={importRunning} importFriends={form.importFriends} handover={handover} remainText={remainText} restaurant={templateKey === 'restaurant'} />
          )}

          {recoveredAccountId ? (
            <Notice
              tone="warn"
              message={error || '保存は終わっている可能性があります。登録済みのアカウントを開いて確認してください。'}
              action={<Button href={`/accounts/detail?id=${encodeURIComponent(recoveredAccountId)}`}>登録したアカウントを見る</Button>}
              onClose={() => { setError(''); setRecoveredAccountId('') }}
            />
          ) : error ? (
            <Notice tone="danger" message={error} onClose={() => setError('')} />
          ) : null}
        </StepContent></div>
        <StickyBar presentation="account-registration" actions={currentStep === 5 ? (
            <Button href="/hq" variant="primary"><ArrowLeft size={15} aria-hidden="true" />統括コンソールへ戻る</Button>
          ) : currentStep === 3 && sub === 1 && !rowsOk ? <>
            <Button type="button" disabled={busy || !canBack} onClick={moveBack}><ArrowLeft size={15} aria-hidden="true" />{backLabel}</Button>
            <Button type="button" variant="primary" disabled={busy || checkRunning} onClick={() => void runCheck()} busy={busyAction === 'check'} busyLabel="確認しています…"><Plug size={15} aria-hidden="true" />{checkActionLabel({ running: checkRunning, attempted: checkAttempted, allOk: rowsOk })}</Button>
          </> : <>
            {canBack
              ? <Button type="button" disabled={busy} onClick={moveBack}><ArrowLeft size={15} aria-hidden="true" />{backLabel}</Button>
              : currentStep === 1 ? <Button href="/hq">キャンセル</Button> : null}
            <Button type="submit" variant="primary" disabled={busy || nextBlocked} busy={busyAction === 'save' || registrationStyle.busy} busyLabel={currentStep === 4 ? '保存しています…' : '登録しています…'}><ArrowRight size={15} aria-hidden="true" />{nextLabel}</Button>
          </>} />
      </form>
      <NoticeLineRegisterDialog open={noticeDialog === 'open'} onClose={() => setNoticeDialog('done')} />
      {stepUp && <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} />}
    </PageFrame></SaveErrorScope>
  )
}
function CopyButton({ value }: { value: string }) {
  return (
    <CopyTextButton value={value} label="コピーする" variant="secondary" icon={<Copy size={15} aria-hidden="true" />} aria-label="値をコピー" disabled={value === '—'} />
  )
}
