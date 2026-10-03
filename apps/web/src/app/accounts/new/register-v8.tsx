'use client'

/*
 * ★V8-B 統括 LINEアカウントを登録（板 `xj3zz` `JYfda` `GwKE2` `v2KMj` `qw80E` `TvXII`）。
 *
 * v7 の登録ウィザード（`page.tsx`・基本情報→LINE準備→チャネル設定→
 * 接続確認→完了）とは手順の並びと見せ方だけが違う。
 * 入力・検証・接続確認（5段）・保存・取り込み・本人確認・重複時の復帰の
 * 動きは v7 と同じで、使う口も同じ（`api.lineAccounts.connectCheck` /
 * `connect` / `stepFollowerImport`＋タグ・友だち総数）。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（二重管理）。
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api, type FollowerImportState, type LineAccountConnectData, type LineAccountConnectVerification, type LineAccountTag } from '@/lib/api'
import StepUpPrompt, { isStepUpRequired, type StepUpRequest } from '@/components/step-up-prompt'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Dialog from '@/components/shared/dialog'
import Notice from '@/components/shared/notice'
import RadioCard from '@/components/shared/radio-card'
import StatusBadge from '@/components/shared/status-badge'
import NoticeLineRegisterDialog from '@/components/hq/notice-line-register-dialog'
import { RequiredBadge } from '@/components/shared/form-controls'
import { canSave, toSteps } from '../connection-check-view'
import { isDuplicateChannelError, matchRegisteredAccountId } from './account-recovery'
import styles from './register-v8.module.css'

const V8_STEPS = [
  { number: 1, label: 'LINE準備', designNode: 'xj3zz' },
  { number: 2, label: 'チャネル設定', designNode: 'JYfda' },
  { number: 3, label: '基本情報', designNode: 'GwKE2' },
  { number: 4, label: '接続確認', designNode: 'v2KMj' },
  { number: 5, label: '完了', designNode: 'TvXII' },
] as const

type StepNumber = (typeof V8_STEPS)[number]['number']
type BusyAction = 'check' | 'save' | 'tags' | null
type FieldErrors = Record<string, string>

type FormState = {
  name: string
  channelId: string
  channelSecret: string
  loginChannelId: string
  loginChannelSecret: string
  lineId: string
  tagIds: string[]
  importFriends: boolean
}

const emptyForm: FormState = {
  name: '', channelId: '', channelSecret: '', loginChannelId: '', loginChannelSecret: '',
  lineId: '', tagIds: [], importFriends: true,
}

/*
 * xj3zz「あとで続きから」用の端末の下書き。秘密値（シークレット）は
 * 書かない（戻ったときに入れ直す）。表示名・ID・手順・タグ・取り込みだけ残す。
 */
const DRAFT_KEY = 'musubo-register-draft-v8'
type DraftState = {
  step: StepNumber
  accountMethod: 'existing' | 'new'
  name: string
  channelId: string
  loginChannelId: string
  lineId: string
  tagIds: string[]
  importFriends: boolean
}

function readDraft(): DraftState | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DraftState>
    if (parsed.step !== 1 && parsed.step !== 2 && parsed.step !== 3 && parsed.step !== 4) return null
    return {
      step: parsed.step,
      accountMethod: parsed.accountMethod === 'new' ? 'new' : 'existing',
      name: typeof parsed.name === 'string' ? parsed.name : '',
      channelId: typeof parsed.channelId === 'string' ? parsed.channelId : '',
      loginChannelId: typeof parsed.loginChannelId === 'string' ? parsed.loginChannelId : '',
      lineId: typeof parsed.lineId === 'string' ? parsed.lineId : '',
      tagIds: Array.isArray(parsed.tagIds) ? parsed.tagIds.filter((id): id is string => typeof id === 'string') : [],
      importFriends: parsed.importFriends !== false,
    }
  } catch {
    return null
  }
}

/* 友だち数の統計は前日分。日本時間の昨日を yyyyMMdd で返す。 */
function insightDateJst(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000)
  const month = String(jst.getUTCMonth() + 1).padStart(2, '0')
  const day = String(jst.getUTCDate()).padStart(2, '0')
  return `${jst.getUTCFullYear()}${month}${day}`
}

type CheckRowState = 'passed' | 'failed' | 'todo'

export interface V8CheckRow {
  key: 'channel' | 'provider' | 'webhook' | 'lineId' | 'addUrl'
  title: string
  detail: string
  state: CheckRowState
  message: string | null
}

/*
 * v2KMj の5行。`verification`（V8の内訳）が無い古い応答のときは
 * 5段の合否から組み立てる。検査前はすべて「まだ」。
 */
export function toV8CheckRows(connection: LineAccountConnectData | null): V8CheckRow[] {
  const steps = toSteps(connection ? { steps: connection.steps } : null)
  const verification = connection?.verification
  const webhook = verification?.webhook
  const webhookChecked = Boolean(connection) && steps[2] !== undefined && steps[2].state !== 'skipped'
  const webhookPassed = Boolean(connection) && steps[2]?.state === 'passed'
  const channelPassed = verification ? verification.tokenOk && verification.loginOk
    : steps[0]?.state === 'passed' && steps[3]?.state === 'passed'
  const channelFailed = Boolean(connection) && !channelPassed
    && (steps[0]?.state === 'failed' || steps[3]?.state === 'failed')
  const providerPassed = verification ? verification.sameProvider : channelPassed
  const providerFailed = Boolean(connection) && !providerPassed
    && (steps[0]?.state === 'failed' || steps[3]?.state === 'failed')
  const basicId = connection?.basicId ?? null
  // 「3（Webhook）が通ると確かめます」：4行目と5行目は Webhook が通るまで「まだ」。
  const lineIdState: CheckRowState = !connection ? 'todo' : webhookPassed && basicId ? 'passed' : 'todo'
  const addUrl = basicId ? `https://lin.ee/${basicId.replace(/^@/, '')}` : null
  const addUrlState: CheckRowState = !connection ? 'todo' : webhookPassed && addUrl ? 'passed' : 'todo'
  return [
    {
      key: 'channel', title: 'チャネルIDとシークレット', detail: 'Messaging API・LINE Login とも認証済み',
      state: !connection ? 'todo' : channelPassed ? 'passed' : channelFailed ? 'failed' : 'todo',
      message: channelFailed ? (steps[0]?.state === 'failed' ? steps[0].message : steps[3]?.message ?? null) : null,
    },
    {
      key: 'provider', title: '同じプロバイダー', detail: '2つのチャネルが同じプロバイダーにある',
      state: !connection ? 'todo' : providerPassed ? 'passed' : providerFailed ? 'failed' : 'todo',
      message: providerFailed ? 'チャネルID・シークレットを確認してください。' : null,
    },
    {
      key: 'webhook', title: 'Webhook', detail: webhookDetail(webhook, webhookChecked, webhookPassed),
      state: !connection || !webhookChecked ? 'todo' : webhookPassed ? 'passed' : 'failed',
      message: !connection || !webhookChecked || webhookPassed ? null : (steps[2]?.message ?? null),
    },
    {
      key: 'lineId', title: 'LINE ID の取得', detail: '3 が通ると確かめます',
      state: lineIdState, message: null,
    },
    {
      key: 'addUrl', title: '友だち追加 URL', detail: '3 が通ると確かめます',
      state: addUrlState, message: null,
    },
  ]
}

function webhookDetail(
  webhook: LineAccountConnectVerification['webhook'] | undefined,
  checked: boolean, passed: boolean,
): string {
  if (!checked) return '「接続して設定する」を押すと確かめます'
  if (passed) return 'musubo の受け口へ届きました'
  if (webhook && webhook.registeredUrl !== null && webhook.registeredUrl !== webhook.expectedUrl) {
    return '登録先が musubo の受け口と違います'
  }
  if (webhook && webhook.active === false) return 'LINE Developers で「Webhook の利用」がオフです'
  return '受け口へ届きませんでした'
}

export function allV8RowsPassed(rows: V8CheckRow[]): boolean {
  return rows.every((row) => row.state === 'passed')
}

function stepErrorsForChannel(form: FormState): FieldErrors {
  const errors: FieldErrors = {}
  if (!form.channelId.trim()) errors.channelId = 'チャネルIDを入力してください。'
  else if (!/^\d+$/.test(form.channelId.trim())) errors.channelId = 'チャネルIDは半角数字で入力してください。'
  if (!form.channelSecret) errors.channelSecret = 'チャネルシークレットを入力してください。'
  if (!form.loginChannelId.trim()) errors.loginChannelId = 'LoginチャネルIDを入力してください。'
  else if (!/^\d+$/.test(form.loginChannelId.trim())) errors.loginChannelId = 'LoginチャネルIDは半角数字で入力してください。'
  if (!form.loginChannelSecret) errors.loginChannelSecret = 'Loginチャネルシークレットを入力してください。'
  return errors
}

export default function RegisterV8() {
  const [accountMethod, setAccountMethod] = useState<'existing' | 'new'>('existing')
  const [currentStep, setCurrentStep] = useState<StepNumber>(1)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [connection, setConnection] = useState<LineAccountConnectData | null>(null)
  const [importState, setImportState] = useState<FollowerImportState | null>(null)
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [error, setError] = useState('')
  const [recoveredAccountId, setRecoveredAccountId] = useState('')
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  // qw80E：接続を確かめた結果の窓。手動の1項目のチェックが無いと登録へ進めない。
  const [resultOpen, setResultOpen] = useState(false)
  const [manualAck, setManualAck] = useState(false)
  const [tags, setTags] = useState<LineAccountTag[] | null>(null)
  const [newTagName, setNewTagName] = useState('')
  const [insightTotal, setInsightTotal] = useState<number | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)
  const [noticeDialog, setNoticeDialog] = useState<'idle' | 'open' | 'done'>('idle')
  const busyLock = useRef(false)
  const stepPanelRef = useRef<HTMLDivElement>(null)

  const steps = toSteps(connection ? { steps: connection.steps } : null)
  const connectionPassed = Boolean(connection && canSave(steps))
  const checkRows = toV8CheckRows(connection)
  const rowsPassed = allV8RowsPassed(checkRows)
  const createdId = connection?.id ?? ''
  const workerBase = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
  const callbackUrl = workerBase ? `${workerBase}/auth/callback` : '—'
  const importingIds = (importState?.phase ?? connection?.followerImport.phase) === 'importing_ids'
  const selectedTags = tags?.filter((tag) => form.tagIds.includes(tag.id)) ?? []

  useEffect(() => { stepPanelRef.current?.focus() }, [currentStep])

  // 端末の下書きがあれば一度だけ戻す（秘密値は書いていないので入れ直す）。
  useEffect(() => {
    const draft = readDraft()
    if (!draft) return
    setAccountMethod(draft.accountMethod)
    setCurrentStep(draft.step)
    setForm((current) => ({
      ...current,
      name: draft.name,
      channelId: draft.channelId,
      loginChannelId: draft.loginChannelId,
      lineId: draft.lineId,
      tagIds: draft.tagIds,
      importFriends: draft.importFriends,
    }))
    setDraftRestored(true)
  }, [])

  // 変わるたびに端末の下書きを残す（秘密値は除く）。登録が終わったら消す。
  useEffect(() => {
    if (createdId) {
      try { window.localStorage.removeItem(DRAFT_KEY) } catch { /* 下書きが消せなくても登録は続ける。 */ }
      return
    }
    const draft: DraftState = {
      step: currentStep,
      accountMethod,
      name: form.name,
      channelId: form.channelId,
      loginChannelId: form.loginChannelId,
      lineId: form.lineId,
      tagIds: form.tagIds,
      importFriends: form.importFriends,
    }
    try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)) } catch { /* 書けなくても入力は続ける。 */ }
  }, [createdId, currentStep, accountMethod, form.name, form.channelId, form.loginChannelId, form.lineId, form.tagIds, form.importFriends])

  // ③でタグの一覧を一度だけ読む。取れなくても登録は続ける。
  useEffect(() => {
    if (currentStep !== 3 || tags !== null) return
    let active = true
    void (async () => {
      try {
        const response = await api.lineAccountTags.list()
        if (active && response.success) setTags(response.data)
      } catch { /* タグ無しでも登録は続ける。 */ }
    })()
    return () => { active = false }
  }, [currentStep, tags])

  // ⑤：取り込みを進める（取り込む設定のときだけ）。
  useEffect(() => {
    if (!createdId || !importingIds || !form.importFriends) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const advance = async () => {
      try {
        const response = await api.lineAccounts.stepFollowerImport(createdId)
        if (!active || !response.success) return
        setImportState(response.data.state)
        if (response.data.state.phase === 'importing_ids') {
          timer = setTimeout(() => void advance(), 350)
        }
      } catch {
        if (active) timer = setTimeout(() => void advance(), 1500)
      }
    }
    void advance()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [createdId, importingIds, form.importFriends])

  // ⑤：取り込みの総数（前日の友だち数）。取れなければ取り込んだ数だけ出す。
  useEffect(() => {
    if (currentStep !== 5 || !createdId || insightTotal !== null) return
    let active = true
    void (async () => {
      try {
        const response = await api.lineAccounts.followerInsight(createdId, insightDateJst())
        if (active && response.success && typeof response.data.followers === 'number') {
          setInsightTotal(response.data.followers)
        }
      } catch { /* 総数が出なくても取り込んだ数は出す。 */ }
    })()
    return () => { active = false }
  }, [currentStep, createdId, insightTotal])

  // 登録完了（取り込みも終わった）直後に契約者専用LINEの案内を一度だけ出す（v7 と同じ）。
  useEffect(() => {
    if (currentStep === 5 && connection && !importingIds && noticeDialog === 'idle') setNoticeDialog('open')
  }, [currentStep, connection, importingIds, noticeDialog])

  const update = (key: keyof FormState, value: string | string[] | boolean) => {
    setForm((current) => ({ ...current, [key]: value } as FormState))
    setFieldErrors((current) => {
      if (typeof key !== 'string' || !(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    if (key === 'channelId' || key === 'channelSecret' || key === 'loginChannelId' || key === 'loginChannelSecret') {
      setConnection(null)
      setManualAck(false)
    }
    setError('')
    setRecoveredAccountId('')
  }

  const input = () => ({
    name: form.name.trim() || undefined,
    channelId: form.channelId.trim(),
    channelSecret: form.channelSecret,
    loginChannelId: form.loginChannelId.trim(),
    loginChannelSecret: form.loginChannelSecret,
  })

  /*
   * R523: 同じチャネルIDで作られた行が残っていないか照合する（v7 と同じ）。
   * 取れなければ null（未保存と断定しない）。
   */
  const findRegisteredAccountId = async (channelId: string): Promise<string | null> => {
    try {
      const list = await api.lineAccounts.list()
      if (!list.success) return null
      return matchRegisteredAccountId(list.data, channelId)
    } catch {
      return null
    }
  }

  const checkConnection = useCallback(async (): Promise<boolean> => {
    const nextErrors = stepErrorsForChannel(form)
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors((current) => ({ ...current, ...nextErrors }))
      setCurrentStep(2)
      setError('接続に必要な4項目を確認してください。')
      return false
    }
    if (busyLock.current) return false
    busyLock.current = true
    setBusyAction('check')
    setConnection(null)
    setManualAck(false)
    setError('')
    try {
      const response = await api.lineAccounts.connectCheck(input())
      if (!response.success) {
        setError(response.error)
        return false
      }
      setConnection(response.data)
      if (response.data.basicId) {
        setForm((current) => ({ ...current, lineId: response.data.basicId ?? current.lineId }))
      }
      if (!canSave(response.data.steps)) {
        setError('止まった項目を直して、もう一度「接続して設定する」を押してください。')
        return false
      }
      return true
    } catch {
      setError('LINEに接続できませんでした。時間をおいて、もう一度お試しください。')
      return false
    } finally {
      busyLock.current = false
      setBusyAction(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.channelId, form.channelSecret, form.loginChannelId, form.loginChannelSecret, form.name])

  // ④「接続して設定する」：検査して、通れば結果の窓（qw80E）を開く。
  const runCheckThenReview = async () => {
    const passed = await checkConnection()
    if (passed) setResultOpen(true)
  }

  // ③「LINEから取得」：同じ検査で LINE ID を先取りする（保存はしない）。
  const fetchLineId = async () => {
    const nextErrors = stepErrorsForChannel(form)
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors((current) => ({ ...current, ...nextErrors }))
      setError('チャネル設定の4項目を先に入力してください。')
      return
    }
    if (busyLock.current) return
    busyLock.current = true
    setBusyAction('check')
    setError('')
    try {
      const response = await api.lineAccounts.connectCheck(input())
      if (!response.success) {
        setError(response.error)
        return
      }
      setConnection(response.data)
      if (response.data.basicId) {
        setForm((current) => ({ ...current, lineId: response.data.basicId ?? current.lineId }))
      } else {
        setError('LINE ID を確認できませんでした。チャネル設定を確認してください。')
      }
    } catch {
      setError('LINEに接続できませんでした。時間をおいて、もう一度お試しください。')
    } finally {
      busyLock.current = false
      setBusyAction(null)
    }
  }

  const save = async (stepUpToken?: string) => {
    if (!connectionPassed || !rowsPassed || busyLock.current) {
      setError('5段すべて通ってから保存してください。')
      return
    }
    busyLock.current = true
    setBusyAction('save')
    setError('')
    setRecoveredAccountId('')
    try {
      const response = await api.lineAccounts.connect(input(), stepUpToken)
      if (!response.success) {
        // R523: 重複は登録済みの詳細へ案内する（v7 と同じ）。
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
      // 選んだタグを付ける。失敗しても登録自体は続ける（あとで付け直せる）。
      if (form.tagIds.length > 0 && response.data.id) {
        try {
          await api.lineAccountTags.setForAccount(response.data.id, form.tagIds)
        } catch {
          setError('タグの付け直しが必要です。アカウントの詳細でタグを付け直してください。')
        }
      }
      setConnection(response.data)
      setForm((current) => ({ ...current, channelSecret: '', loginChannelSecret: '' }))
      setResultOpen(false)
      setCurrentStep(5)
    } catch (caught) {
      // LINEの接続は大事な操作。本人確認を求められたら窓を立ててやり直す（v7 と同じ）。
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'line_account.connect', action: 'LINEの接続を登録する', retry: save })
        return
      }
      // R523: 応答が無い失敗は「未保存」と断定しない（v7 と同じ）。
      const recovered = await findRegisteredAccountId(form.channelId)
      if (recovered) {
        setRecoveredAccountId(recovered)
        setError('保存は終わっている可能性があります。登録済みのアカウントを開いて確認してください。')
        return
      }
      setError('登録できませんでした。時間をおいて、もう一度お試しください。')
    } finally {
      busyLock.current = false
      setBusyAction(null)
    }
  }

  const moveNext = () => {
    if (currentStep === 2) {
      const nextErrors = stepErrorsForChannel(form)
      if (Object.keys(nextErrors).length > 0) {
        setFieldErrors((current) => ({ ...current, ...nextErrors }))
        setError('入力内容を確認してください。')
        return
      }
    }
    if (currentStep === 3 && form.name.trim().length > 40) {
      setFieldErrors((current) => ({ ...current, name: '表示名は40文字以内で入力してください。' }))
      setError('入力内容を確認してください。')
      return
    }
    setError('')
    if (currentStep < 4) setCurrentStep((currentStep + 1) as StepNumber)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    moveNext()
  }

  const addTag = async () => {
    const name = newTagName.trim()
    if (!name || busyLock.current) return
    busyLock.current = true
    setBusyAction('tags')
    setError('')
    try {
      const response = await api.lineAccountTags.create(name)
      if (!response.success) {
        setError(response.error)
        return
      }
      setTags((current) => [...(current ?? []), response.data])
      setForm((current) => ({ ...current, tagIds: [...current.tagIds, response.data.id] }))
      setNewTagName('')
    } catch {
      setError('タグを追加できませんでした。時間をおいて、もう一度お試しください。')
    } finally {
      busyLock.current = false
      setBusyAction(null)
    }
  }

  const toggleTag = (id: string) => {
    setForm((current) => ({
      ...current,
      tagIds: current.tagIds.includes(id)
        ? current.tagIds.filter((tagId) => tagId !== id)
        : [...current.tagIds, id],
    }))
  }

  const importedCount = importState?.imported ?? 0
  const progressTotal = insightTotal ?? (importingIds ? null : importedCount)
  const progressRate = progressTotal && progressTotal > 0
    ? Math.min(100, Math.round((importedCount / progressTotal) * 100))
    : (importingIds ? 0 : 100)

  return (
    <div className={styles.board}>
      <div className={styles.head}>
        <h1>LINEアカウントを登録</h1>
        <p>{currentStep === 4 && !createdId
          ? '接続確認が5段すべて通るまで登録しません。止まった項目を直して、もう一度「接続して設定する」を押します。'
          : currentStep === 5 ? '登録が完了しました。' : '画面に出る名前と、だれがこのアカウントを扱うかを決めます。'}</p>
      </div>

      <ol className={styles.steps} aria-label="登録の進捗">
        {V8_STEPS.map((step) => {
          const done = currentStep > step.number || Boolean(createdId)
          const active = currentStep === step.number && !createdId
          return (
            <li
              key={step.number}
              aria-current={active ? 'step' : undefined}
              className={`${styles.step} ${active ? styles.stepCurrent : ''} ${done ? styles.stepDone : ''} ${!active && !done ? styles.stepTodo : ''}`}
            >
              <span className={styles.stepMark} aria-hidden>{done ? '✓' : step.number}</span>
              <span className={styles.stepLabel}>{step.label}</span>
            </li>
          )
        })}
      </ol>

      <form onSubmit={submit} noValidate aria-busy={busyAction ? true : undefined}>
        <div ref={stepPanelRef} tabIndex={-1} className="outline-none">
          {currentStep === 1 && (
            <div data-design-node="xj3zz">
              <section className={styles.panel} aria-label="LINEの用意">
                <h2>LINEの用意</h2>
                <div className={styles.panelBody}>
                  {draftRestored && (
                    <Notice tone="info" message="端末の下書きから続けます。チャネルシークレットだけ入れ直してください。" onClose={() => setDraftRestored(false)} />
                  )}
                  <fieldset>
                    <legend className={styles.fieldLabel}>登録したいのは、もうある公式アカウントですか</legend>
                    <div className={styles.twoCol}>
                      <RadioCard name="account-method-v8" value="existing" checked={accountMethod === 'existing'} onChange={() => setAccountMethod('existing')} title="すでにある公式アカウント" note="公式アカウントとプロバイダーをこのまま使う" />
                      <RadioCard name="account-method-v8" value="new" checked={accountMethod === 'new'} onChange={() => setAccountMethod('new')} title="これから作る" note="公式アカウントと2つのチャネルを新しく用意する" />
                    </div>
                  </fieldset>
                  <div className={styles.noteBox}>
                    {accountMethod === 'existing'
                      ? 'LINE Developers で Messaging API と LINE Login のチャネルが同じプロバイダーにあることを確かめます。'
                      : 'LINE公式アカウントを作ってから、同じプロバイダー内に Messaging API と LINE Login のチャネルを用意します。'}
                    <br />
                    <a href="https://developers.line.biz/console/" target="_blank" rel="noreferrer" className="text-action font-semibold hover:underline">LINE Developers を開く</a>
                    {accountMethod === 'new' && (
                      <>　<a href="https://manager.line.biz/" target="_blank" rel="noreferrer" className="text-action font-semibold hover:underline">LINE公式アカウントを作る（LINE Official Account Manager）</a></>
                    )}
                    　<a href="/manuals/line-connect/index.html#m1" target="_blank" rel="noreferrer" className="text-action font-semibold hover:underline">マニュアルを見る</a>
                  </div>
                  <p className={styles.fieldHelp}>3番が終わるまでに、チャネルIDとシークレットが要ります。4番では自動で接続を確かめます。</p>
                </div>
              </section>
            </div>
          )}

          {currentStep === 2 && (
            <div data-design-node="JYfda">
              <section className={styles.panel} aria-label="チャネル設定">
                <h2>チャネル設定</h2>
                <div className={styles.panelBody}>
                  <div className={styles.twoCol}>
                    <div>
                      <label className={styles.fieldLabel} htmlFor="v8-channel-id">Messaging API のチャネルID<RequiredBadge /></label>
                      <input id="v8-channel-id" className={styles.fieldInput} value={form.channelId} onChange={(event) => update('channelId', event.target.value)} inputMode="numeric" required aria-invalid={fieldErrors.channelId ? true : undefined} />
                      {fieldErrors.channelId && <p className={styles.fieldError}>{fieldErrors.channelId}</p>}
                      <p className={styles.fieldHelp}>LINE Developers の Messaging API チャネルで取得　<a href="/manuals/line-connect/index.html#m1" target="_blank" rel="noreferrer" className="text-action font-semibold hover:underline">取得方法を見る</a></p>
                    </div>
                    <div>
                      <label className={styles.fieldLabel} htmlFor="v8-channel-secret">Messaging API のチャネルシークレット<RequiredBadge /></label>
                      <input id="v8-channel-secret" type="password" autoComplete="new-password" className={styles.fieldInput} value={form.channelSecret} onChange={(event) => update('channelSecret', event.target.value)} required aria-invalid={fieldErrors.channelSecret ? true : undefined} />
                      {fieldErrors.channelSecret && <p className={styles.fieldError}>{fieldErrors.channelSecret}</p>}
                    </div>
                    <div>
                      <label className={styles.fieldLabel} htmlFor="v8-login-channel-id">LINE Login のチャネルID<RequiredBadge /></label>
                      <input id="v8-login-channel-id" className={styles.fieldInput} value={form.loginChannelId} onChange={(event) => update('loginChannelId', event.target.value)} inputMode="numeric" required aria-invalid={fieldErrors.loginChannelId ? true : undefined} />
                      {fieldErrors.loginChannelId && <p className={styles.fieldError}>{fieldErrors.loginChannelId}</p>}
                      <p className={styles.fieldHelp}>LIFF は自動で作ります。Messaging API と同じプロバイダーのチャネル　<a href="/manuals/line-connect/index.html#m2" target="_blank" rel="noreferrer" className="text-action font-semibold hover:underline">取得方法を見る</a></p>
                    </div>
                    <div>
                      <label className={styles.fieldLabel} htmlFor="v8-login-channel-secret">LINE Login のチャネルシークレット<RequiredBadge /></label>
                      <input id="v8-login-channel-secret" type="password" autoComplete="new-password" className={styles.fieldInput} value={form.loginChannelSecret} onChange={(event) => update('loginChannelSecret', event.target.value)} required aria-invalid={fieldErrors.loginChannelSecret ? true : undefined} />
                      {fieldErrors.loginChannelSecret && <p className={styles.fieldError}>{fieldErrors.loginChannelSecret}</p>}
                    </div>
                  </div>
                  <p className={styles.fieldHelp}>検査中は「次へ」を押せません。入力を変えると接続確認はやり直しになります。</p>
                </div>
              </section>
            </div>
          )}

          {currentStep === 3 && (
            <div data-design-node="GwKE2">
              <section className={styles.panel} aria-label="基本情報">
                <h2>基本情報</h2>
                <div className={styles.panelBody}>
                  <div className={styles.twoCol}>
                    <div>
                      <label className={styles.fieldLabel} htmlFor="v8-display-name">表示名</label>
                      <input id="v8-display-name" className={styles.fieldInput} value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="未入力なら LINE公式アカウントの名前を使います" aria-invalid={fieldErrors.name ? true : undefined} />
                      {fieldErrors.name && <p className={styles.fieldError}>{fieldErrors.name}</p>}
                    </div>
                    <div>
                      <label className={styles.fieldLabel} htmlFor="v8-line-id">LINE ID</label>
                      <div className={styles.endpointRow}>
                        <input id="v8-line-id" className={styles.fieldInput} value={form.lineId} readOnly placeholder="「LINEから取得」を押すと入ります" aria-readonly />
                        <Button type="button" onClick={() => void fetchLineId()} disabled={busyAction === 'check'} busy={busyAction === 'check'} busyLabel="取得しています…">LINEから取得</Button>
                      </div>
                    </div>
                  </div>
                  <div>
                    <span className={styles.fieldLabel}>タグ</span>
                    <div className={styles.tagRow}>
                      {(tags ?? []).map((tag) => (
                        <button key={tag.id} type="button" className={styles.tagPill} aria-pressed={form.tagIds.includes(tag.id)} onClick={() => toggleTag(tag.id)}>
                          {tag.name}
                        </button>
                      ))}
                      {tags !== null && tags.length === 0 && (
                        <span className={styles.fieldHelp}>タグはまだありません。下から追加できます。</span>
                      )}
                    </div>
                    <div className={styles.endpointRow} style={{ marginTop: 8 }}>
                      <input className={styles.fieldInput} value={newTagName} onChange={(event) => setNewTagName(event.target.value)} placeholder="新しいタグの名前" aria-label="新しいタグの名前" maxLength={100} />
                      <Button type="button" onClick={() => void addTag()} disabled={!newTagName.trim() || busyAction === 'tags'} busy={busyAction === 'tags'} busyLabel="追加しています…">タグを追加</Button>
                    </div>
                  </div>
                  <div className={styles.noteBox}>LIFF は登録のときに自動で作ります。親アカウントと担当範囲は、登録のあと「設定」と「メンバー」で決めます。</div>
                  <div>
                    <span className={styles.fieldLabel}>Callback URL</span>
                    <div className={styles.endpointRow}>
                      <p className={styles.endpointValue}>{callbackUrl}</p>
                      <CopyButton value={callbackUrl} />
                    </div>
                    <p className={styles.fieldHelp}>LINE Login → Callback URL <a href="/manuals/line-connect/index.html#m3" target="_blank" rel="noreferrer" className="text-action font-semibold hover:underline">設定方法を見る</a></p>
                  </div>
                </div>
              </section>
            </div>
          )}

          {currentStep === 4 && !createdId && (
            <div data-design-node="v2KMj">
              <section className={styles.panel} aria-label="接続確認">
                <h2>接続確認</h2>
                <div className={styles.panelBody}>
                  <div className={styles.checkGrid}>
                    <ol className={styles.checkList} aria-label="接続確認項目">
                      {checkRows.map((row) => (
                        <li key={row.key} className={`${styles.checkRow} ${row.state === 'passed' ? styles.checkPass : ''} ${row.state === 'failed' ? styles.checkFail : ''} ${row.state === 'todo' ? styles.checkTodo : ''}`}>
                          <span className={styles.checkIcon} aria-hidden>{row.state === 'passed' ? '✓' : row.state === 'failed' ? '×' : '○'}</span>
                          <span className={styles.checkText}>
                            <span className={styles.checkTitle}>{row.title} <span className={styles.checkDetailInline}>{rowTitleValue(row, connection)}</span></span>
                            <span className={styles.checkSub}>{row.detail}</span>
                            {row.message && <span className={styles.checkSub}>{row.message}</span>}
                          </span>
                          <StatusBadge tone={row.state === 'passed' ? 'success' : row.state === 'failed' ? 'warning' : 'neutral'}>
                            {row.state === 'passed' ? '通った' : row.state === 'failed' ? '止まった' : 'まだ'}
                          </StatusBadge>
                        </li>
                      ))}
                    </ol>
                    <aside className={styles.reviewBox} aria-label="登録内容を確認する">
                      <h3>登録内容を確認する</h3>
                      <dl>
                        <div><dt>表示名</dt><dd>{form.name.trim() || (connection?.displayName ? `${connection.displayName}（LINEから取得）` : 'LINEから取得')}</dd></div>
                        <div><dt>LINE ID</dt><dd>{form.lineId || '接続確認で取得します'}</dd></div>
                        <div><dt>タグ</dt><dd>{selectedTags.length > 0 ? selectedTags.map((tag) => tag.name).join('・') : 'なし'}</dd></div>
                      </dl>
                      <p className={styles.fieldHelp}>親アカウントと担当範囲は、登録のあと「設定」と「メンバー」で決めます。</p>
                    </aside>
                  </div>
                  <div className={styles.panel}>
                    <Checkbox
                      checked={form.importFriends}
                      onCheckedChange={(checked) => update('importFriends', checked)}
                      description="登録のあと、いまの友だちを musubo に取り込みます（数分かかります）"
                    >
                      既存の友だちの取り込み
                    </Checkbox>
                  </div>
                  <div className={styles.actions}>
                    <Button type="button" disabled={Boolean(busyAction)} onClick={() => { setError(''); setCurrentStep(3) }}>戻る</Button>
                    <Button type="button" variant="primary" disabled={Boolean(busyAction)} onClick={() => void runCheckThenReview()} busy={busyAction === 'check'} busyLabel="接続して設定しています…">接続して設定する</Button>
                  </div>
                </div>
              </section>
            </div>
          )}

          {currentStep === 5 && connection && (
            <div data-design-node="TvXII">
              <section className={styles.panel} aria-label="登録完了">
                <h2>登録が完了しました</h2>
                <div className={styles.panelBody}>
                  <p className={styles.checkTitle}>
                    ✓ {(connection.displayName ?? form.name.trim()) || 'LINEアカウント'}
                    {connection.basicId ? `（${connection.basicId}）を登録しました` : 'を登録しました'}
                  </p>
                  {connection.followerImport.capability === 'available' && form.importFriends ? (
                    <div className={styles.noteBox}>
                      <div className={styles.progressCaption}>
                        <span>既存の友だちを取り込んでいます</span>
                        <span>{importingIds
                          ? `${importedCount}人${progressTotal !== null ? ` / ${progressTotal}人` : ' / 確認中'}`
                          : `${importedCount}人取り込みました`}</span>
                      </div>
                      <div className={styles.progressTrack} role="progressbar" aria-valuenow={progressRate} aria-valuemin={0} aria-valuemax={100} aria-label="友だちの取り込み">
                        <div className={styles.progressFill} style={{ width: `${progressRate}%` }} />
                      </div>
                      <p className={styles.fieldHelp}>この画面を開いている間に取り込みます。閉じると止まり、もう一度開くと続きから取り込みます。</p>
                    </div>
                  ) : (
                    <div className={styles.noteBox}>
                      {connection.followerImport.capability === 'available'
                        ? '既存の友だちの取り込みはオフになっています。取り込むときはアカウントの詳細から始めてください。'
                        : 'LINE の都合で取り込めないアカウントでは、友だちが話しかけた順に登録されます。'}
                    </div>
                  )}
                  {connection.remainingActions.length > 0 && (
                    <div className={styles.noteBox}>
                      <p className={styles.checkTitle}>残りの手作業</p>
                      <ul>{connection.remainingActions.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                  )}
                  <div>
                    <p className={styles.checkTitle}>次にすること</p>
                    <div className={styles.nextList}>
                      <Button href={`/accounts/detail?id=${encodeURIComponent(createdId)}`}>登録したアカウントを見る</Button>
                      <Button href="/friends">友だち一覧</Button>
                      <Button href="/friend-add-settings">友だち追加URL・QR</Button>
                      <Button href="/emergency">運用状態の接続監視</Button>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>

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
        <NoticeLineRegisterDialog open={noticeDialog === 'open'} onClose={() => setNoticeDialog('done')} />
        {stepUp && <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} />}

        {!createdId && currentStep < 4 && (
          <div className={styles.actions}>
            {currentStep === 1 ? (
              <Button href="/hq">あとで続きから</Button>
            ) : (
              <Button type="button" disabled={Boolean(busyAction)} onClick={() => { setError(''); setCurrentStep((currentStep - 1) as StepNumber) }}>戻る</Button>
            )}
            <Button type="submit" variant="primary" disabled={Boolean(busyAction) || (currentStep === 2 && busyAction === 'check')}>次へ</Button>
          </div>
        )}
        {!createdId && currentStep === 5 && (
          <div className={styles.actions}>
            <Button href="/hq" variant="primary">統括コンソールへ戻る</Button>
          </div>
        )}
      </form>

      <Dialog
        open={resultOpen}
        onCancel={() => setResultOpen(false)}
        title="接続を確かめた結果"
        designNode="qw80E"
        footer={(
          <>
            <Button type="button" disabled={Boolean(busyAction)} onClick={() => void runCheckThenReview()} busy={busyAction === 'check'} busyLabel="調べています…">もう一度調べる</Button>
            <Button
              type="button"
              variant="primary"
              disabled={!rowsPassed || !manualAck || Boolean(busyAction)}
              onClick={() => void save()}
              busy={busyAction === 'save'}
              busyLabel="登録しています…"
            >
              確認コードを入れて登録する
            </Button>
          </>
        )}
      >
        <div>
          <p className={styles.checkSub}>自動で調べた4項目と、LINE の画面で手で確かめる1項目があります。</p>
          <table className={styles.resultTable}>
            <tbody>
              <ResultRow label="チャネルアクセストークン" value={rowsPassed || checkRows[0].state === 'passed' ? '正しく読めました' : '読み取れませんでした'} passed={checkRows[0].state === 'passed'} pending={checkRows[0].state === 'todo'} />
              <ResultRow label="Webhook の URL" value={checkRows[2].state === 'passed' ? 'musubo の受け口へ届きました' : webhookDetail(connection?.verification?.webhook, checkRows[2].state !== 'todo', false)} passed={checkRows[2].state === 'passed'} pending={checkRows[2].state === 'todo'} />
              <ResultRow label="Webhook の利用" value={checkRows[2].state === 'passed' ? 'LINE 側で「オン」でした' : 'まだ確かめていません'} passed={checkRows[2].state === 'passed'} pending={checkRows[2].state === 'todo'} />
              <ResultRow
                label="ボットの情報"
                value={connection?.displayName ? `表示名「${connection.displayName}」${connection.verification?.followerTotal != null ? `・友だち${connection.verification.followerTotal}人` : ''}` : 'まだ確かめていません'}
                passed={Boolean(connection?.displayName)}
                pending={!connection}
              />
              <tr>
                <td className={styles.resultLabel}>応答メッセージ</td>
                <td>API では調べられません</td>
                <td><StatusBadge tone="neutral">手動で確かめる</StatusBadge></td>
              </tr>
            </tbody>
          </table>
          <div className={styles.manualAck}>
            <Checkbox checked={manualAck} onCheckedChange={setManualAck}>
              LINE Official Account Manager で「応答メッセージ」をオフにしたことを確かめました
            </Checkbox>
          </div>
          {!rowsPassed && (
            <Notice tone="warn" message="止まった項目を直して、もう一度調べます。手動の1項目にチェックを入れても登録はできません。" />
          )}
        </div>
      </Dialog>
    </div>
  )
}

function rowTitleValue(row: V8CheckRow, connection: LineAccountConnectData | null): string {
  if (row.key === 'lineId' && row.state === 'passed') return connection?.basicId ?? ''
  if (row.key === 'addUrl' && row.state === 'passed' && connection?.basicId) {
    return `https://lin.ee/${connection.basicId.replace(/^@/, '')}`
  }
  return ''
}

function ResultRow({ label, value, passed, pending }: { label: string; value: string; passed: boolean; pending: boolean }) {
  return (
    <tr>
      <td className={styles.resultLabel}>{label}</td>
      <td>{value}</td>
      <td><StatusBadge tone={passed ? 'success' : 'neutral'}>{pending ? 'まだ' : passed ? '通った' : '止まった'}</StatusBadge></td>
    </tr>
  )
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (value === '—') return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch { /* 表示値を選択してコピーできる。 */ }
  }
  return (
    <Button type="button" onClick={() => void copy()} disabled={value === '—'} className="shrink-0">
      {copied ? 'コピー済み' : 'コピー'}
    </Button>
  )
}

