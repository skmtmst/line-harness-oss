'use client'

import CopyTextButton from '@/components/shared/copy-text-button'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  Activity, ArrowLeft, ArrowRight, BookOpen, Check, CircleAlert, CircleCheck, CircleDashed,
  Copy, Lock, CircleHelp, Plug, QrCode, Users,
} from 'lucide-react'
import { api, type FollowerImportState, type LineAccountConnectData } from '@/lib/api'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import { CreateStepColumns } from '@/components/templates/create-step-columns'
import { Steps } from '@/components/templates/steps'
import StepUpPrompt, { isStepUpRequired, type StepUpRequest } from '@/components/step-up-prompt'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import { SettingsFormRow } from '@/components/shared/settings-form-card'
import StickyBar from '@/components/shared/sticky-bar'
import Checkbox from '@/components/shared/checkbox'
import Notice from '@/components/shared/notice'
import Radio from '@/components/shared/radio'
import { TextField } from '@/components/shared/text-field'
import { Field } from '@/components/shared/form-controls'
import NoticeLineRegisterDialog from '@/components/hq/notice-line-register-dialog'
import {
  DRAFT_KEY, LOGIN_ACKS, WEBHOOK_ACKS, allAcked, allV06RowsOk, channelErrors, checkActionLabel, checkErrorText,
  checkStage, developerChannelUrl, formatJaDuration, handoverProgress, insightDateJst, isDuplicateChannelError,
  loginChannelErrors, matchRegisteredAccountId, messagingApiErrors, nextCursor, readDraft, stepBadge, subTotal,
  templateOptions, toV06CheckRows,
  type DraftState, type StepNumber,
} from './logic'
import styles from './register.module.css'
import { qrToDataURL } from '@/lib/qr-image'
import { formatNumber as polishFormatNumber } from '@/lib/format'
import TruncatedText from '@/components/shared/truncated-text'
import { emptyValue } from '@/components/shared/empty-value'
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'

/*
 * ★v06 LINEアカウントを登録（板 ①p6zMkA ②Fqy29 ③Lwxyh ④X0pGdw ⑤Plmq1）。
 * 利用者承認済みの LINE新規追加_v06.pen（2026-10-15 承認）どおりに書き換えた。
 *
 * V8-B（①xj3zz〜⑤TvXII・結果の窓 qw80E）との違い：
 * ・5段の中身を「事前確認／アカウント接続／接続確認／使い方を選ぶ／完了」に変えた。
 * ・②は小さな段が3つ（Messaging API → LINE Login → Webhook）。LINE Developers 側で
 *   やることはチェックで確かめてから次へ進む。
 * ・③は小さな段が2つ。1つめで5行を1行ずつ確かめ、通ったら「次へ」で登録する（ここで
 *   アカウントが作られる）。2つめで自分のスマホから友だち追加して届くかを見る。
 * ・結果の窓（qw80E）はやめて、③の画面に行を出す。
 * ・④は使い方（ひな形）を選ぶ。いまは飲食店向けだけ開いている。
 * ・⑤は友だちの引き継ぎの進み具合を出して、終わったら完了にする。
 *
 * 使う口は今までと同じ（api.lineAccounts.connectCheck / connect / stepFollowerImport /
 * followerImportState / followerInsight、api.lineAccounts.list、api.friends.list）。
 * 動きの一覧は同じ場所の BEHAVIOR.md。
 *
 * 取り込みの進捗は followerImportState を読むだけでは次の cron（5 分ごと）まで動かないので、
 * 画面を開いている間は stepFollowerImport で続きを進める。閉じたあとは cron が拾う。
 */

const V8_STEPS: ReadonlyArray<{ number: StepNumber; label: string; node: string; lead: string }> = [
  { number: 1, label: '事前確認', node: 'p6zMkA', lead: 'LINE公式アカウントと2つのチャネルを用意します。接続確認が通るまで、アカウントは作られません。' },
  { number: 2, label: 'アカウント接続', node: 'Fqy29', lead: 'LINE Developers の画面からコピーして貼り付けます。秘密値は保存後に画面へ表示されません。' },
  { number: 3, label: '接続確認', node: 'Lwxyh', lead: '5つの確認がすべて通ってから登録します。そのあと自分のスマホで友だち追加を試します。' },
  { number: 4, label: '使い方を選ぶ', node: 'X0pGdw', lead: 'いちばん近い使い方を選びます。あとから変えられます。' },
  { number: 5, label: '完了', node: 'Plmq1', lead: 'いまの友だちを引き継いでいます。終わると完了です。' },
]

const MANUAL = '/manuals/line-connect/index.html'

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
  const saveErrors = useSaveFormErrors()
  usePageTitle('LINEアカウントを登録')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: 'アカウント', href: '/hq' }])

  const [accountMethod, setAccountMethod] = useState<'existing' | 'new'>('existing')
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
  const [testFollowed, setTestFollowed] = useState(false)
  const [templateKey, setTemplateKey] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [insightTotal, setInsightTotal] = useState<number | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)
  const [noticeDialog, setNoticeDialog] = useState<'idle' | 'open' | 'done'>('idle')
  const busyLock = useRef(false)
  const stepPanelRef = useRef<HTMLDivElement>(null)

  const checkRows = toV06CheckRows(connection, { running: checkRunning, cursor: checkCursor })
  const rowsOk = allV06RowsOk(checkRows)
  const checkNotice = checkErrorText(checkStage(connection, checkRunning), checkRows)
  const badge = stepBadge(currentStep, sub)
  const createdId = connection?.id ?? ''
  const workerBase = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
  const callbackUrl = workerBase ? `${workerBase}/auth/callback` : emptyValue('unknown')
  const webhookUrl = workerBase && form.channelId.trim() ? `${workerBase}/webhook/${form.channelId.trim()}` : emptyValue('unknown')
  const importPhase = importState?.phase ?? connection?.followerImport.phase ?? ''
  const importRunning = importPhase === 'importing_ids' || importPhase === 'hydrating_profiles'
  const basicId = connection?.basicId ?? ''
  const addFriendUrl = basicId ? `https://line.me/R/ti/p/${encodeURIComponent(basicId.startsWith('@') ? basicId : `@${basicId}`)}` : ''
  const shownStep = V8_STEPS[currentStep - 1]

  useEffect(() => { stepPanelRef.current?.focus() }, [currentStep, sub])
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
    setAccountMethod(draft.accountMethod)
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
      step: currentStep, sub, accountMethod, name: form.name, channelId: form.channelId, loginChannelId: form.loginChannelId,
      lineId: form.lineId, tagIds: form.tagIds, parentId: form.parentId, staffIds: form.staffIds, liffId: form.liffId,
      importFriends: form.importFriends,
    }
    try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)) } catch (saveFailure) {
      saveErrors.capture(saveFailure) /* 書けなくても入力は続ける。 */ }
  }, [createdId, currentStep, sub, accountMethod, form.name, form.channelId, form.loginChannelId, form.lineId, form.tagIds, form.parentId, form.staffIds, form.liffId, form.importFriends, saveErrors])

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
        const dataUrl = await qrToDataURL(addFriendUrl, { width: 220, margin: 1, color: { dark: '#171717', light: '#ffffff' } })
        if (!cancelled) setQrDataUrl(dataUrl)
      } catch (saveFailure) {
        saveErrors.capture(saveFailure) /* QRが出なくてもURLから追加できる。 */ }
    })()
    return () => { cancelled = true }
  }, [currentStep, sub, addFriendUrl, saveErrors])

  // ③-2：友だちが1人でも届いたら「届きました」に変える。
  useEffect(() => {
    if (currentStep !== 3 || sub !== 2 || !createdId || testFollowed) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const response = await api.friends.list({ accountId: createdId, limit: 1, includeTags: false })
        if (!active) return
        if (response.success && response.data.total > 0) { setTestFollowed(true); return }
      } catch (saveFailure) {
        saveErrors.capture(saveFailure) /* 一度届かなくても次で拾う。 */ }
      if (active) timer = setTimeout(() => void poll(), 5000)
    }
    void poll()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [currentStep, sub, createdId, testFollowed, saveErrors])

  /* ⑤：画面を開いている間は続きを進める。読み取りだけだと次の cron（5 分ごと）まで
   * 進まないので、1 回ぶんが終わったらすぐ次を呼ぶ。1 回ぶんは Worker 側の予算で
   * 区切られ、カーソルは D1 に残る。画面を閉じても cron と「入る」が続きを拾う。
   * 同じアカウントを別の経路が握っているときは busy が返るだけで壊れない。 */
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
      if (response.data.basicId) setForm((current) => ({ ...current, lineId: response.data.basicId ?? current.lineId }))
      // 止まった行は③の一覧が赤で示し、下の帯が「どこを直すか」を言う。同じ文を重ねない。
    } catch (saveFailure) {
      setCheckRunning(false)
      const fieldFailure = saveErrors.capture(saveFailure)

      { if (!fieldFailure)

      setError('LINEに接続できませんでした。時間をおいて、もう一度お試しください。') }
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
      // v06：登録できたら③の2つめ（友だち追加のためし）へ進む。
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
        { if (!fieldFailure)
        setError('保存は終わっている可能性があります。登録済みのアカウントを開いて確認してください。') }
        return
      }
      { if (!fieldFailure)
      setError('登録できませんでした。時間をおいて、もう一度お試しください。') }
    } finally {
      busyLock.current = false
      setBusyAction(null)
    }
  }

  const moveNext = () => {
    setError('')
    if (currentStep === 1) { setCurrentStep(2); setSub(1); return }
    if (currentStep === 2) {
      if (sub === 1) {
        const nextErrors = messagingApiErrors(form)
        if (Object.keys(nextErrors).length > 0) { setFieldErrors((current) => ({ ...current, ...nextErrors })); return }
        setSub(2)
        return
      }
      if (sub === 2) {
        const nextErrors = loginChannelErrors(form)
        if (Object.keys(nextErrors).length > 0) { setFieldErrors((current) => ({ ...current, ...nextErrors })); return }
        if (!allAcked(LOGIN_ACKS, acks)) return
        setSub(3)
        return
      }
      if (!allAcked(WEBHOOK_ACKS, acks)) return
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
      setCurrentStep(4)
      setSub(1)
      return
    }
    if (currentStep === 4) {
      if (!templateKey) return
      setCurrentStep(5)
      setSub(1)
    }
  }

  const moveBack = () => {
    setError('')
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
  const busy = Boolean(busyAction)
  // 登録したあとは戻らない（③の2つめから先）。
  const canBack = !createdId && (currentStep > 1 || sub > 1)
  const nextBlocked = (currentStep === 2 && sub === 2 && !allAcked(LOGIN_ACKS, acks))
    || (currentStep === 2 && sub === 3 && !allAcked(WEBHOOK_ACKS, acks))
    || (currentStep === 3 && sub === 1 && !rowsOk)
    || (currentStep === 4 && !templateKey)

  return (
    <SaveErrorScope errors={saveErrors}><PageFrame kind="wizard" boardId={shownStep.node}>
      <PageHeading
        title="LINEアカウントを登録"
        help={shownStep.lead}
        /* ★v06 p6zMkA〜Plmq1：手順は題と同じ行（題・手順・？の順）。 */
        titleAccessory={(
          <div><Steps
            label="登録の進捗"
            /* v06はアカウントを③で作るので、作ったあとも⑤へ飛ばさない。 */
            currentKey={String(currentStep)}
            steps={V8_STEPS.map((step) => ({
              key: String(step.number),
              label: step.label,
              order: step.number,
              state: currentStep > step.number ? 'done' as const : 'todo' as const,
              /* 登録する前は、済んだ段を押すとその段へ戻る（入れた値はそのまま）。登録した後は戻らない。 */
              onSelect: !createdId && currentStep > step.number ? () => { setCurrentStep(step.number); setSub(1) } : undefined,
            }))}
          /></div>
        )}
      />
      <form className={styles.body} onSubmit={submit} noValidate aria-busy={busy || undefined}>
        <div ref={stepPanelRef} tabIndex={-1} className={styles.stepBody}>
          {currentStep === 1 && (
            <CreateStepColumns data-design-node="p6zMkA" previewTitle="この5段でやること" preview={(
                <Card className={styles.aside} layout="vertical" surface="muted" contentPadding="var(--tpl-htn-aside-pad)" gap="var(--tpl-htn-aside-gap)" aria-label="この5段でやること">
                <h2>この5段でやること</h2>
                <p>① 事前確認：公式アカウントと2つのチャネルを用意</p>
                <p>② アカウント接続：チャネル ID とシークレット、LINE側の設定</p>
                <p>③ 接続確認：5つの確認が通ってから登録し、友だち追加を試す</p>
                <p>④ 使い方を選ぶ：いちばん近いひな形を選ぶ</p>
                <p>⑤ 完了：いまの友だちの引き継ぎ</p>
              </Card>
              )}>
              <Card surface="standard" layout="vertical" contentPadding="var(--tpl-htn-panel-pad)" gap="var(--tpl-htn-panel-gap)" className={styles.panel} aria-label="アカウントの用意方法">
                {draftRestored && (
                  <Notice tone="info" message="端末の下書きから続けます。チャネルシークレットだけ入れ直してください。" onClose={() => setDraftRestored(false)} />
                )}
                <fieldset className={styles.fieldset}>
                  <legend className={styles.panelTitle}>アカウントの用意方法</legend>
                  <div className={styles.radios}>
                    <SaveErrorField names={["account-method-v8","accountMethod"]}><Radio name="account-method-v8" value="existing" checked={accountMethod === 'existing'} onChange={() => setAccountMethod('existing')}>既存の公式アカウントを使う</Radio></SaveErrorField>
                    <SaveErrorField names={["account-method-v8","accountMethod"]}><Radio name="account-method-v8" value="new" checked={accountMethod === 'new'} onChange={() => setAccountMethod('new')}>新しく公式アカウントを作成</Radio></SaveErrorField>
                  </div>
                </fieldset>
                <Card className={styles.noteBox} layout="vertical" surface="muted" corner="control" contentPadding="var(--tpl-htn-note-pad)" gap="var(--tpl-htn-gap-s)">
                  <p>{accountMethod === 'existing'
                    ? 'LINE公式アカウントを作成してから、同じプロバイダー内に Messaging API と LINE Login のチャネルを用意します。'
                    : 'LINE公式アカウントを作成してから、同じプロバイダー内に Messaging API と LINE Login のチャネルを用意します。新しく作るときは、先に公式アカウントを作ります。'}</p>
                  <p>・Messaging API と LINE Login は同じプロバイダーで作成してください<br />・Webhook の利用は LINE Developers でオンにしてください</p>
                </Card>
                <div className={styles.buttonRow}>
                  <Button external href="https://manager.line.biz/"  >LINE公式アカウントを作る</Button>
                  <Button external href="https://developers.line.biz/console/"  >LINE Developersを開く</Button>
                  <Button external href={`${MANUAL}#m1`}  ><BookOpen size={15} aria-hidden="true" />全手順を見る</Button>
                </div>
              </Card>
            </CreateStepColumns>
          )}

          {currentStep === 2 && (
            <CreateStepColumns data-design-node="Fqy29" previewTitle="どこにある？" preview={(
                <Card className={styles.aside} layout="vertical" surface="muted" contentPadding="var(--tpl-htn-aside-pad)" gap="var(--tpl-htn-aside-gap)" aria-label="どこにある？">
                <h2>どこにある？</h2>
                <p>チャネル ID とシークレットは、LINE Developers → プロバイダー → チャネル → 「チャネル基本設定」にあります。</p>
                <p>登録済みのチャネル ID を入れると「このチャネルIDは登録済みです」と出て先へ進めません。</p>
                <p>秘密値は保存後に画面へ表示されません。</p>
              </Card>
              )}>
              {sub === 1 && (
                <Card surface="standard" layout="vertical" contentPadding="var(--tpl-htn-panel-pad)" gap="var(--tpl-htn-panel-gap)" className={styles.panel} aria-label="Messaging API のチャネル">
                  <p className={styles.subBadge}>{badge}</p>
                  <h2 className={styles.panelTitle}>Messaging API のチャネル</h2>
                  <SettingsFormRow layout="columns">
                    <Field htmlFor="v8-channel-id" label="チャネルID" error={fieldErrors.channelId}>
                      <SaveErrorField names={["channelId","form.channelId","channel_id","form.channel_id"]}><TextField id="v8-channel-id" value={form.channelId} onChange={(event) => update('channelId', event.target.value)} inputMode="numeric" required aria-invalid={fieldErrors.channelId ? true : undefined} /></SaveErrorField>
                    </Field>
                    <Field htmlFor="v8-channel-secret" label="チャネルシークレット" error={fieldErrors.channelSecret}>
                      <SaveErrorField names={["channelSecret","form.channelSecret","channel_secret","form.channel_secret"]}><TextField id="v8-channel-secret" type="password" autoComplete="new-password" value={form.channelSecret} onChange={(event) => update('channelSecret', event.target.value)} required aria-invalid={fieldErrors.channelSecret ? true : undefined} /></SaveErrorField>
                    </Field>
                  </SettingsFormRow>
                  <div className={styles.secretRow}>
                    <span className={styles.secretNote}><Lock size={14} aria-hidden="true" />秘密値は保存後に画面へ表示されません。</span>
                    <Button external href={`${MANUAL}#m1`}  ><CircleHelp size={15} aria-hidden="true" />取得方法を見る</Button>
                  </div>
                </Card>
              )}
              {sub === 2 && (
                <Card surface="standard" layout="vertical" contentPadding="var(--tpl-htn-panel-pad)" gap="var(--tpl-htn-panel-gap)" className={styles.panel} aria-label="LINE Login のチャネル">
                  <p className={styles.subBadge}>{badge}</p>
                  <h2 className={styles.panelTitle}>LINE Login のチャネル</h2>
                  <SettingsFormRow layout="columns">
                    <Field htmlFor="v8-login-channel-id" label="LoginチャネルID" error={fieldErrors.loginChannelId}>
                      <SaveErrorField names={["loginChannelId","form.loginChannelId","login_channel_id","form.login_channel_id"]}><TextField id="v8-login-channel-id" value={form.loginChannelId} onChange={(event) => update('loginChannelId', event.target.value)} inputMode="numeric" required aria-invalid={fieldErrors.loginChannelId ? true : undefined} /></SaveErrorField>
                    </Field>
                    <Field htmlFor="v8-login-channel-secret" label="Loginチャネルシークレット" error={fieldErrors.loginChannelSecret}>
                      <SaveErrorField names={["loginChannelSecret","form.loginChannelSecret","login_channel_secret","form.login_channel_secret"]}><TextField id="v8-login-channel-secret" type="password" autoComplete="new-password" value={form.loginChannelSecret} onChange={(event) => update('loginChannelSecret', event.target.value)} required aria-invalid={fieldErrors.loginChannelSecret ? true : undefined} /></SaveErrorField>
                    </Field>
                  </SettingsFormRow>
                  <div className={styles.field}>
                    <span className={styles.groupLabel}>Callback URL</span>
                    <Card layout="horizontal" surface="muted" corner="control" contentPadding="var(--space-8) var(--space-8) var(--space-8) var(--polish-space-card)" gap="var(--tpl-htn-panel-gap)">
                      <span className={styles.endpointValue} ><TruncatedText value={String(callbackUrl ?? '')} url /></span>
                      <CopyButton value={callbackUrl} />
                    </Card>
                  </div>
                  <p className={styles.groupLabel}>LINE Developers でやること</p>
                  <div className={styles.ackList}>
                    {LOGIN_ACKS.map((ack) => (
                      <div key={ack.key}>
                        <SaveErrorField names={[ack.key]}><Checkbox checked={Boolean(acks[ack.key])} onCheckedChange={(next) => toggleAck(ack.key, next)}>{ack.label}</Checkbox></SaveErrorField>
                        <p className={styles.ackNote}>{ack.note}</p>
                      </div>
                    ))}
                  </div>
                  <div className={styles.buttonRow}>
                    <Button external href={developerChannelUrl(form.loginChannelId)}  >LINE Developersでこのチャネルを開く</Button>
                  </div>
                </Card>
              )}
              {sub === 3 && (
                <Card surface="standard" layout="vertical" contentPadding="var(--tpl-htn-panel-pad)" gap="var(--tpl-htn-panel-gap)" className={styles.panel} aria-label="Webhook の設定">
                  <p className={styles.subBadge}>{badge}</p>
                  <h2 className={styles.panelTitle}>Webhook の設定</h2>
                  <div className={styles.field}>
                    <span className={styles.groupLabel}>Webhook URL</span>
                    <Card layout="horizontal" surface="muted" corner="control" contentPadding="var(--space-8) var(--space-8) var(--space-8) var(--polish-space-card)" gap="var(--tpl-htn-panel-gap)">
                      <span className={styles.endpointValue} ><TruncatedText value={String(webhookUrl ?? '')} url /></span>
                      <CopyButton value={webhookUrl} />
                    </Card>
                  </div>
                  <div className={styles.ackList}>
                    {WEBHOOK_ACKS.map((ack) => (
                      <div key={ack.key}>
                        <SaveErrorField names={[ack.key]}><Checkbox checked={Boolean(acks[ack.key])} onCheckedChange={(next) => toggleAck(ack.key, next)}>{ack.label}</Checkbox></SaveErrorField>
                        <p className={styles.ackNote}>{ack.note}</p>
                      </div>
                    ))}
                  </div>
                  <div className={styles.buttonRow}>
                    <Button external href={developerChannelUrl(form.channelId)}  >LINE Developersでこのチャネルを開く</Button>
                    <Button external href={`${MANUAL}#m1`}  ><CircleHelp size={15} aria-hidden="true" />設定の場所を見る</Button>
                  </div>
                </Card>
              )}
            </CreateStepColumns>
          )}

          {currentStep === 3 && sub === 1 && (
            <CreateStepColumns data-design-node="Lwxyh" previewTitle="ここで登録します" preview={(
                <Card className={styles.aside} layout="vertical" surface="muted" contentPadding="var(--tpl-htn-aside-pad)" gap="var(--tpl-htn-aside-gap)" aria-label="ここで登録します">
                <h2>ここで登録します</h2>
                <p>5つの確認がすべて通るまで、アカウントは作られません。</p>
                <p>止まった項目を直して、もう一度「もう一度確かめる」を押します。</p>
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
                  <div className={styles.errorBox} data-tone={checkNotice.tone} role={checkNotice.tone === 'danger' ? 'alert' : undefined}>
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
                <h2>ためしに友だち追加</h2>
                <p>自分のスマホの LINE で QR を読み取って、友だち追加してみてください。</p>
                <p>届かなくても先へ進めます。あとから友だち一覧で確かめられます。</p>
              </Card>
              )}>
              <Card surface="standard" layout="vertical" contentPadding="var(--tpl-htn-panel-pad)" gap="var(--tpl-htn-panel-gap)" className={styles.panel} aria-label="ためしに友だち追加">
                <p className={styles.subBadge}>{badge}</p>
                <h2 className={styles.panelTitle}>ためしに友だち追加してみましょう</h2>
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
                    <div className={styles.errorBox} data-tone={testFollowed ? 'info' : undefined}>
                      <p>{testFollowed ? '友だち追加が届きました' : 'まだ届いていません'}</p>
                      <p>{testFollowed ? 'musubo の友だち一覧に入りました。次へ進んでください。' : '読み取って友だち追加すると、ここが自動で変わります。届かなくても先へ進めます。'}</p>
                    </div>
                  </div>
                </div>
              </Card>
            </CreateStepColumns>
          )}

          {currentStep === 4 && (
            <CreateStepColumns data-design-node="X0pGdw" previewTitle="あとから変えられます" preview={(
                <Card className={styles.aside} layout="vertical" surface="muted" contentPadding="var(--tpl-htn-aside-pad)" gap="var(--tpl-htn-aside-gap)" aria-label="あとから変えられます">
                <h2>あとから変えられます</h2>
                <p>選んだ使い方でダッシュボードの並びが決まります。</p>
                <p>カードは、あとから自分で足し引きできます。</p>
              </Card>
              )}>
              <Card surface="standard" layout="vertical" contentPadding="var(--tpl-htn-panel-pad)" gap="var(--tpl-htn-panel-gap)" className={styles.panel} aria-label="使い方を選ぶ">
                <h2 className={styles.panelTitle}>いちばん近い使い方を選んでください</h2>
                <div className={styles.templateGrid}>
                  {templateOptions().map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={styles.templateCard}
                      aria-pressed={templateKey === option.key}
                      disabled={!option.enabled}
                      onClick={() => { setTemplateKey(option.key); setError('') }}
                    >
                      <span className={styles.templateHead}>
                        <span className={styles.templateLabel}>{option.label}</span>
                        {!option.enabled && <span className={styles.templateBand}>準備中</span>}
                      </span>
                      <span className={styles.templateNote}>{option.note}</span>
                    </button>
                  ))}
                </div>
              </Card>
            </CreateStepColumns>
          )}

          {currentStep === 5 && connection && (
            <Card surface="standard" layout="vertical" contentPadding="var(--tpl-htn-panel-pad)" gap="var(--tpl-htn-panel-gap)" className={styles.panel} aria-label={importRunning ? 'いまの友だちを引き継いでいます' : '登録完了'} data-design-node="Plmq1">
              {importRunning && form.importFriends ? <>
                <h2 className={styles.panelTitle}>いまの友だちを引き継いでいます</h2>
                <Card className={styles.handoverBox} layout="vertical" surface="muted" corner="control" contentPadding="var(--tpl-htn-note-pad)" gap="var(--tpl-htn-gap-xs)">
                  <div className={styles.handoverStats}>
                    <strong>{`${polishFormatNumber(handover.imported)} 人`}</strong>
                    <strong>{handover.total !== null ? `${polishFormatNumber(handover.total)} 人` : '確認中'}</strong>
                  </div>
                  <div className={styles.progressTrack} role="progressbar" aria-valuenow={handover.rate} aria-valuemin={0} aria-valuemax={100} aria-label="友だちの引き継ぎ">
                    <span className={styles.progressFill} style={{ width: `${handover.rate}%` }} />
                  </div>
                  <p className={styles.progressNote}>{remainText}</p>
                  <p className={styles.progressWarn}>引き継ぎは画面を閉じても続きます。もう一度開くと進み具合を確認できます。</p>
                </Card>
              </> : <>
                <div className={styles.doneHero}>
                  <CircleCheck size={28} aria-hidden="true" />
                  <p className={styles.doneTitle}>準備ができました</p>
                </div>
                <Card className={styles.accountBox} layout="vertical" surface="muted" corner="control" contentPadding="var(--tpl-htn-note-pad)" gap="var(--tpl-htn-gap-xs)">
                  <span className={styles.accountName}>{(connection.displayName ?? form.name.trim()) || 'LINEアカウント'}</span>
                  <span className={styles.accountId}>{connection.basicId || String(emptyValue('none'))}</span>
                </Card>
                <Card layout="vertical" surface="muted" corner="control" contentPadding="var(--tpl-htn-note-pad)" gap="var(--tpl-htn-gap-xs)">
                  {form.importFriends
                    ? <p className={styles.progressNote}>{`いまの友だちを ${polishFormatNumber(handover.imported)} 人 引き継ぎました。`}</p>
                    : <p className={styles.progressNote}>いまの友だちの引き継ぎはオフになっています。引き継ぐときはアカウントの詳細から始めてください。</p>}
                  <p className={styles.progressNote}>LINE の都合で引き継げないアカウントでは、友だちが話しかけた順に登録されます。</p>
                </Card>
                {connection.remainingActions.length > 0 && (
                  <Card className={styles.noteBox} layout="vertical" surface="muted" corner="control" contentPadding="var(--tpl-htn-note-pad)" gap="var(--tpl-htn-gap-s)">
                    <p><strong>残りの手作業</strong></p>
                    <ul>{connection.remainingActions.map((item) => <li key={item}>{item}</li>)}</ul>
                  </Card>
                )}
                <p className={styles.groupLabel}>次にすること</p>
                <div className={styles.useRow}>
                  <Button external href={`/accounts/detail?id=${encodeURIComponent(createdId)}`}>登録したアカウントを見る</Button>
                  <Button href="/friends"><Users size={15} aria-hidden="true" />友だち一覧</Button>
                  <Button href="/friend-add-settings"><QrCode size={15} aria-hidden="true" />友だち追加URL・QR</Button>
                  <Button href="/emergency"><Activity size={15} aria-hidden="true" />運用状態の接続監視</Button>
                </div>
              </>}
            </Card>
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
        </div>
        <StickyBar presentation="account-registration" actions={currentStep === 5 ? (
            <Button href="/hq" variant="primary"><ArrowLeft size={15} aria-hidden="true" />統括コンソールへ戻る</Button>
          ) : currentStep === 3 && sub === 1 && !rowsOk ? <>
            <Button type="button" disabled={busy || !canBack} onClick={moveBack}><ArrowLeft size={15} aria-hidden="true" />戻る</Button>
            <Button type="button" variant="primary" disabled={busy || checkRunning} onClick={() => void runCheck()} busy={busyAction === 'check'} busyLabel="確認しています…"><Plug size={15} aria-hidden="true" />{checkActionLabel({ running: checkRunning, attempted: checkAttempted, allOk: rowsOk })}</Button>
          </> : <>
            {canBack
              ? <Button type="button" disabled={busy} onClick={moveBack}><ArrowLeft size={15} aria-hidden="true" />戻る</Button>
              : currentStep === 1 ? <Button href="/hq">キャンセル</Button> : null}
            <Button type="submit" variant="primary" disabled={busy || nextBlocked} busy={busyAction === 'save'} busyLabel="登録しています…"><ArrowRight size={15} aria-hidden="true" />{currentStep === 3 && sub === 1 ? '登録する' : '次へ'}</Button>
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
