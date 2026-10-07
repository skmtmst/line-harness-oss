'use client'

/*
 * ★V8-B 統括 LINEアカウントを登録（板 ①xj3zz ②JYfda ③GwKE2 ④v2KMj ⑤TvXII・結果の窓 qw80E）。
 *
 * 2026-10-07 src/v8 に一から書いた。入力・検証・接続確認（5段）・保存・取り込み・本人確認・
 * 重複時の復帰・端末の下書きの動きは今の登録（app/accounts/new/register-v8.tsx）と同じで、
 * 使う口も同じ（api.lineAccounts.connectCheck / connect / followerImportState / followerInsight、
 * api.lineAccountTags、api.lineAccounts.list・api.staff.list）。違いは見せ方だけ。
 * 動きの一覧は同じ場所の BEHAVIOR.md。
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, CircleCheck, CircleDashed, CircleDot, CircleX,
  Copy, Download, ExternalLink, Lock, CircleHelp, Plug, QrCode, ShieldCheck, Star, RotateCw, Users, Activity,
} from 'lucide-react'
import { api, type FollowerImportState, type LineAccountConnectData, type LineAccountTag } from '@/lib/api'
import type { StaffMember } from '@line-crm/shared'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import StepUpPrompt, { isStepUpRequired, type StepUpRequest } from '@/components/step-up-prompt'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Select from '@/components/shared/select'
import Dialog from '@/components/shared/dialog'
import Notice from '@/components/shared/notice'
import Radio from '@/components/shared/radio'
import Toggle from '@/components/shared/toggle'
import StatusBadge from '@/components/shared/status-badge'
import NoticeLineRegisterDialog from '@/components/hq/notice-line-register-dialog'
import {
  DRAFT_KEY, allV8RowsPassed, canSave, channelErrors, insightDateJst, isDuplicateChannelError,
  matchRegisteredAccountId, readDraft, toSteps, toV8CheckRows, webhookDetail,
  type DraftState, type StepNumber, type V8CheckRow,
} from './logic'
import styles from './register.module.css'

const V8_STEPS: ReadonlyArray<{ number: StepNumber; label: string; node: string; lead: string }> = [
  { number: 1, label: 'LINE準備', node: 'xj3zz', lead: '5段すべて通ってから登録します。接続確認が通るまで、アカウントは作られません。' },
  { number: 2, label: 'チャネル設定', node: 'JYfda', lead: 'LINE Developers の画面からコピーして貼り付けます。秘密値は保存後に画面へ表示されません。' },
  { number: 3, label: '基本情報', node: 'GwKE2', lead: '画面に出る名前と、だれがこのアカウントを扱うかを決めます。' },
  { number: 4, label: '接続確認', node: 'v2KMj', lead: '接続確認が5段すべて通るまで登録しません。止まった項目を直して、もう一度「接続して設定する」を押します。' },
  { number: 5, label: '完了', node: 'TvXII', lead: '登録が完了しました。' },
]

const MANUAL = '/manuals/line-connect/index.html'

type BusyAction = 'check' | 'save' | 'tags' | null
interface FormState {
  name: string; channelId: string; channelSecret: string; loginChannelId: string; loginChannelSecret: string
  lineId: string; tagIds: string[]; parentId: string; staffIds: string[]; liffId: string; importFriends: boolean
}
const emptyForm: FormState = {
  name: '', channelId: '', channelSecret: '', loginChannelId: '', loginChannelSecret: '',
  lineId: '', tagIds: [], parentId: '', staffIds: [], liffId: '', importFriends: true,
}

export default function AccountRegisterV8() {
  usePageTitle('LINEアカウントを登録')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: 'アカウント', href: '/hq' }])

  const [accountMethod, setAccountMethod] = useState<'existing' | 'new'>('existing')
  const [currentStep, setCurrentStep] = useState<StepNumber>(1)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [connection, setConnection] = useState<LineAccountConnectData | null>(null)
  const [importState, setImportState] = useState<FollowerImportState | null>(null)
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [recoveredAccountId, setRecoveredAccountId] = useState('')
  const [stepUp, setStepUp] = useState<StepUpRequest | null>(null)
  const [resultOpen, setResultOpen] = useState(false)
  const [manualAck, setManualAck] = useState(false)
  const [tags, setTags] = useState<LineAccountTag[] | null>(null)
  const [parents, setParents] = useState<Array<{ id: string; name: string }>>([])
  const [staffOptions, setStaffOptions] = useState<StaffMember[]>([])
  const [optionsError, setOptionsError] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [tagInputOpen, setTagInputOpen] = useState(false)
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
  const shownStep = V8_STEPS[(createdId ? 5 : currentStep) - 1]

  useEffect(() => { stepPanelRef.current?.focus() }, [currentStep])

  // 端末の下書きがあれば一度だけ戻す（秘密値は書いていないので入れ直す）。
  useEffect(() => {
    const draft = (() => { try { return readDraft(window.localStorage) } catch { return null } })()
    if (!draft) return
    setAccountMethod(draft.accountMethod)
    setCurrentStep(draft.step)
    setForm((current) => ({
      ...current, name: draft.name, channelId: draft.channelId, loginChannelId: draft.loginChannelId, lineId: draft.lineId,
      tagIds: draft.tagIds, parentId: draft.parentId, staffIds: draft.staffIds, liffId: draft.liffId, importFriends: draft.importFriends,
    }))
    setDraftRestored(true)
  }, [])

  // 変わるたびに端末の下書きを残す（秘密値は除く）。登録が終わったら消す。
  useEffect(() => {
    if (createdId) {
      try { window.localStorage.removeItem(DRAFT_KEY) } catch { /* 消せなくても登録は続ける。 */ }
      return
    }
    const draft: DraftState = {
      step: currentStep, accountMethod, name: form.name, channelId: form.channelId, loginChannelId: form.loginChannelId,
      lineId: form.lineId, tagIds: form.tagIds, parentId: form.parentId, staffIds: form.staffIds, liffId: form.liffId,
      importFriends: form.importFriends,
    }
    try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)) } catch { /* 書けなくても入力は続ける。 */ }
  }, [createdId, currentStep, accountMethod, form.name, form.channelId, form.loginChannelId, form.lineId, form.tagIds, form.parentId, form.staffIds, form.liffId, form.importFriends])

  // ③でタグの一覧を一度だけ読む。取れなくても登録は続ける。
  useEffect(() => {
    if (currentStep < 3 || tags !== null) return
    let active = true
    void (async () => {
      try {
        const response = await api.lineAccountTags.list()
        if (active && response.success) setTags(response.data)
      } catch { /* タグ無しでも登録は続ける。 */ }
    })()
    return () => { active = false }
  }, [currentStep, tags])

  // ③：親アカウント・担当者の候補。取れなくても登録は続ける。
  useEffect(() => {
    if (currentStep !== 3) return
    let active = true
    void (async () => {
      try {
        const [accounts, staff] = await Promise.all([api.lineAccounts.list(), api.staff.list()])
        if (!accounts.success || !staff.success) throw new Error('候補取得失敗')
        if (active) {
          setParents(accounts.data.filter((a) => a.isActive && !a.archivedAt).map((a) => ({ id: a.id, name: a.name })))
          setStaffOptions(staff.data.filter((s) => s.isActive && s.accountScope === 'accounts' && s.inviteStatus === 'active'))
          setOptionsError('')
        }
      } catch { if (active) setOptionsError('親アカウント・担当者を読み込めませんでした。選択する場合は画面を開き直してください。') }
    })()
    return () => { active = false }
  }, [currentStep])

  // ⑤：Workerが画面を閉じても進める取り込みを、読み取りだけで確認する。
  useEffect(() => {
    if (!createdId || !['importing_ids', 'hydrating_profiles'].includes(importState?.phase ?? connection?.followerImport.phase ?? '') || !form.importFriends) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const advance = async () => {
      try {
        const response = await api.lineAccounts.followerImportState(createdId)
        if (!active || !response.success) return
        setImportState(response.data)
        if (['importing_ids', 'hydrating_profiles'].includes(response.data.phase)) timer = setTimeout(() => void advance(), 3000)
      } catch {
        if (active) timer = setTimeout(() => void advance(), 5000)
      }
    }
    void advance()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [createdId, importState?.phase, connection?.followerImport.phase, form.importFriends])

  // ⑤：取り込みの総数（前日の友だち数）。取れなければ取り込んだ数だけ出す。
  useEffect(() => {
    if (currentStep !== 5 || !createdId || insightTotal !== null) return
    let active = true
    void (async () => {
      try {
        const response = await api.lineAccounts.followerInsight(createdId, insightDateJst())
        if (active && response.success && typeof response.data.followers === 'number') setInsightTotal(response.data.followers)
      } catch { /* 総数が出なくても取り込んだ数は出す。 */ }
    })()
    return () => { active = false }
  }, [currentStep, createdId, insightTotal])

  // 登録完了（取り込みも終わった）直後に契約者専用LINEの案内を一度だけ出す。
  useEffect(() => {
    if (currentStep === 5 && connection && !importingIds && noticeDialog === 'idle') setNoticeDialog('open')
  }, [currentStep, connection, importingIds, noticeDialog])

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
    tagIds: form.tagIds, staffIds: form.staffIds, parentLineAccountId: form.parentId || null,
    ...(form.liffId.trim() ? { liffId: form.liffId.trim() } : {}),
  })

  /* R523: 同じチャネルIDで作られた行が残っていないか照合する。取れなければ null（未保存と断定しない）。 */
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
    const nextErrors = channelErrors(form)
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
      if (response.data.basicId) setForm((current) => ({ ...current, lineId: response.data.basicId ?? current.lineId }))
      // 止まった段は④の行が赤で示し、題の下の説明が「直してもう一度押す」を言う。同じ文を帯で重ねない。
      if (!canSave(response.data.steps)) return false
      return true
    } catch {
      setError('LINEに接続できませんでした。時間をおいて、もう一度お試しください。')
      return false
    } finally {
      busyLock.current = false
      setBusyAction(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.channelId, form.channelSecret, form.loginChannelId, form.loginChannelSecret, form.name, form.tagIds, form.staffIds, form.parentId, form.liffId])

  // ④「接続して設定する」：検査して、通れば結果の窓（qw80E）を開く。
  const runCheckThenReview = async () => {
    const passed = await checkConnection()
    if (passed) setResultOpen(true)
  }

  // ③「LINEから取得」：同じ検査で LINE ID を先取りする（保存はしない）。
  const fetchLineId = async () => {
    const nextErrors = channelErrors(form)
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
      if (response.data.basicId) setForm((current) => ({ ...current, lineId: response.data.basicId ?? current.lineId }))
      else setError('LINE ID を確認できませんでした。チャネル設定を確認してください。')
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
      setResultOpen(false)
      setCurrentStep(5)
    } catch (caught) {
      // LINEの接続は大事な操作。本人確認を求められたら窓を立ててやり直す。
      if (!stepUpToken && isStepUpRequired(caught)) {
        setStepUp({ purpose: 'line_account.connect', action: 'LINEの接続を登録する', retry: save })
        return
      }
      // R523: 応答が無い失敗は「未保存」と断定しない。
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
      const nextErrors = channelErrors(form)
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
      setTagInputOpen(false)
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
      tagIds: current.tagIds.includes(id) ? current.tagIds.filter((tagId) => tagId !== id) : [...current.tagIds, id],
    }))
  }

  const importedCount = importState?.imported ?? 0
  const progressTotal = insightTotal ?? (importingIds ? null : importedCount)
  const progressRate = progressTotal && progressTotal > 0
    ? Math.min(100, Math.round((importedCount / progressTotal) * 100))
    : (importingIds ? 0 : 100)
  const parentName = parents.find((parent) => parent.id === form.parentId)?.name
  const staffNames = staffOptions.filter((member) => form.staffIds.includes(member.id)).map((member) => member.name)
  const busy = Boolean(busyAction)

  return (
    <PageFrame kind="wizard" boardId={shownStep.node}>
      <PageHeading title="LINEアカウントを登録" description={shownStep.lead} />
      <form className={styles.body} onSubmit={submit} noValidate aria-busy={busy || undefined}>
        <ol className={styles.steps} aria-label="登録の進捗">
          {V8_STEPS.map((step) => {
            const done = currentStep > step.number || (Boolean(createdId) && step.number < 5)
            const active = createdId ? step.number === 5 : currentStep === step.number
            return (
              <li key={step.number} className={styles.step} data-state={active ? 'current' : done ? 'done' : 'todo'} aria-current={active ? 'step' : undefined}>
                <span className={styles.stepMark} aria-hidden="true">{done ? <Check size={12} strokeWidth={3} /> : step.number}</span>
                <span className={styles.stepLabel}>{step.label}</span>
              </li>
            )
          })}
        </ol>

        <div ref={stepPanelRef} tabIndex={-1} className={styles.stepBody}>
          {currentStep === 1 && !createdId && (
            <div className={styles.split} data-design-node="xj3zz">
              <section className={styles.panel} aria-label="アカウントの用意方法">
                {draftRestored && (
                  <Notice tone="info" message="端末の下書きから続けます。チャネルシークレットだけ入れ直してください。" onClose={() => setDraftRestored(false)} />
                )}
                <fieldset className={styles.fieldset}>
                  <legend className={styles.panelTitle}>アカウントの用意方法</legend>
                  <div className={styles.radios}>
                    <Radio className={styles.radio} name="account-method-v8" value="existing" checked={accountMethod === 'existing'} onChange={() => setAccountMethod('existing')}>既存の公式アカウントを使う</Radio>
                    <Radio className={styles.radio} name="account-method-v8" value="new" checked={accountMethod === 'new'} onChange={() => setAccountMethod('new')}>新しく公式アカウントを作成</Radio>
                  </div>
                </fieldset>
                <div className={styles.noteBox}>
                  <p>{accountMethod === 'existing'
                    ? 'LINE公式アカウントを作成してから、同じプロバイダー内に Messaging API と LINE Login のチャネルを用意します。'
                    : 'LINE公式アカウントを作成してから、同じプロバイダー内に Messaging API と LINE Login のチャネルを用意します。新しく作るときは、先に公式アカウントを作ります。'}</p>
                  <p>・Messaging API と LINE Login は同じプロバイダーで作成してください<br />・Webhook の利用は LINE Developers でオンにしてください</p>
                </div>
                <div className={styles.buttonRow}>
                  <Button href="https://manager.line.biz/" target="_blank" rel="noreferrer"><ExternalLink size={15} aria-hidden="true" />LINE公式アカウントを作る</Button>
                  <Button href="https://developers.line.biz/console/" target="_blank" rel="noreferrer"><ExternalLink size={15} aria-hidden="true" />LINE Developersを開く</Button>
                  <Button href={`${MANUAL}#m1`} target="_blank" rel="noreferrer"><BookOpen size={15} aria-hidden="true" />全手順を見る</Button>
                </div>
              </section>
              <aside className={styles.aside} aria-label="この5段でやること">
                <h2>この5段でやること</h2>
                <p>① LINE準備：公式アカウントとチャネルを用意</p>
                <p>② チャネル設定：チャネル ID とシークレット 4項目</p>
                <p>③ 基本情報：表示名・LINE ID・担当範囲</p>
                <p>④ 接続確認：5つの確認がすべて通るまで登録しない</p>
                <p>⑤ 完了：既存の友だちの取り込み</p>
              </aside>
            </div>
          )}

          {currentStep === 2 && !createdId && (
            <div className={styles.split} data-design-node="JYfda">
              <section className={styles.panel} aria-label="接続に必要な4項目">
                <h2 className={styles.panelTitle}>接続に必要な4項目</h2>
                <p className={styles.groupLabel}>Messaging API</p>
                <div className={styles.twoCol}>
                  <Field id="v8-channel-id" label="チャネルID" error={fieldErrors.channelId}>
                    <input id="v8-channel-id" className={styles.input} value={form.channelId} onChange={(event) => update('channelId', event.target.value)} inputMode="numeric" required aria-invalid={fieldErrors.channelId ? true : undefined} />
                  </Field>
                  <Field id="v8-channel-secret" label="チャネルシークレット" error={fieldErrors.channelSecret}>
                    <input id="v8-channel-secret" type="password" autoComplete="new-password" className={styles.input} value={form.channelSecret} onChange={(event) => update('channelSecret', event.target.value)} required aria-invalid={fieldErrors.channelSecret ? true : undefined} />
                  </Field>
                </div>
                <p className={styles.groupLabel}>LINE Login</p>
                <div className={styles.twoCol}>
                  <Field id="v8-login-channel-id" label="LoginチャネルID" error={fieldErrors.loginChannelId}>
                    <input id="v8-login-channel-id" className={styles.input} value={form.loginChannelId} onChange={(event) => update('loginChannelId', event.target.value)} inputMode="numeric" required aria-invalid={fieldErrors.loginChannelId ? true : undefined} />
                  </Field>
                  <Field id="v8-login-channel-secret" label="Loginチャネルシークレット" error={fieldErrors.loginChannelSecret}>
                    <input id="v8-login-channel-secret" type="password" autoComplete="new-password" className={styles.input} value={form.loginChannelSecret} onChange={(event) => update('loginChannelSecret', event.target.value)} required aria-invalid={fieldErrors.loginChannelSecret ? true : undefined} />
                  </Field>
                </div>
                <div className={styles.secretRow}>
                  <span className={styles.secretNote}><Lock size={14} aria-hidden="true" />秘密値は保存後に画面へ表示されません。</span>
                  <Button href={`${MANUAL}#m1`} target="_blank" rel="noreferrer"><CircleHelp size={15} aria-hidden="true" />取得方法を見る</Button>
                </div>
              </section>
              <aside className={styles.aside} aria-label="どこにある？">
                <h2>どこにある？</h2>
                <p>チャネル ID とシークレットは、LINE Developers → プロバイダー → チャネル → 「チャネル基本設定」にあります。</p>
                <p>登録済みのチャネル ID を入れると「このチャネルIDは登録済みです」と出て先へ進めません。</p>
              </aside>
            </div>
          )}

          {currentStep === 3 && !createdId && (
            <section className={styles.panel} aria-label="基本情報" data-design-node="GwKE2" data-step="3">
              <h2 className={styles.panelTitle}>基本情報</h2>
              <div className={styles.basicGrid}>
                <label className={styles.label} htmlFor="v8-display-name">表示名</label>
                <label className={styles.label} htmlFor="v8-line-id">LINE ID</label>
                <span aria-hidden="true" />
                <input id="v8-display-name" className={styles.input} value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="未入力なら LINE公式アカウントの名前を使います" aria-invalid={fieldErrors.name ? true : undefined} />
                <input id="v8-line-id" className={styles.input} value={form.lineId} readOnly placeholder="「LINEから取得」を押すと入ります" aria-readonly />
                <Button type="button" onClick={() => void fetchLineId()} disabled={busyAction === 'check'} busy={busyAction === 'check'} busyLabel="取得しています…"><Download size={15} aria-hidden="true" />LINEから取得</Button>
              </div>
              {fieldErrors.name && <p className={styles.fieldError}>{fieldErrors.name}</p>}
              <div className={styles.field}>
                <span className={styles.groupLabel}>タグ</span>
                <div className={styles.tagRow}>
                  {(tags ?? []).map((tag) => {
                    const on = form.tagIds.includes(tag.id)
                    return (
                      <button key={tag.id} type="button" className={styles.tagChip} aria-pressed={on} onClick={() => toggleTag(tag.id)}>
                        {on ? <CircleDot size={12} aria-hidden="true" /> : <Star size={12} aria-hidden="true" />}{tag.name}
                      </button>
                    )
                  })}
                  {tagInputOpen ? (
                    <span className={styles.tagAdd}>
                      <input className={styles.input} value={newTagName} onChange={(event) => setNewTagName(event.target.value)} placeholder="新しいタグの名前" aria-label="新しいタグの名前" maxLength={100} autoFocus />
                      <Button type="button" onClick={() => void addTag()} disabled={!newTagName.trim() || busyAction === 'tags'} busy={busyAction === 'tags'} busyLabel="追加しています…">追加</Button>
                    </span>
                  ) : (
                    <Button type="button" onClick={() => setTagInputOpen(true)}>タグを追加</Button>
                  )}
                </div>
              </div>
              <div className={styles.infoBox}>
                <p>LIFF は登録のときに自動で作ります。親アカウントと担当範囲は、登録のあと「設定」と「メンバー」で決めます。</p>
                <button type="button" className={styles.linkButton} aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>{moreOpen ? '閉じる' : 'いま決める'}</button>
              </div>
              {moreOpen && (
                <div className={styles.moreBox}>
                  <div className={styles.twoCol}>
                    <div className={styles.field}><span className={styles.label}>親アカウント</span><Select aria-label="親アカウント" value={form.parentId} onChange={(value) => update('parentId', value)} options={[{ value: '', label: '親なし' }, ...parents.map((a) => ({ value: a.id, label: a.name }))]} /></div>
                    <div className={styles.field}><label className={styles.label} htmlFor="v8-existing-liff">既存のLIFF ID（任意）</label><input id="v8-existing-liff" className={styles.input} value={form.liffId} onChange={(event) => update('liffId', event.target.value)} placeholder="未入力なら自動で用意します" /></div>
                  </div>
                  <fieldset className={styles.fieldset}>
                    <legend className={styles.label}>このアカウントを担当範囲に追加する人</legend>
                    <div className={styles.tagRow}>{staffOptions.map((member) => <Checkbox key={member.id} aria-label={member.name} checked={form.staffIds.includes(member.id)} onCheckedChange={(checked) => update('staffIds', checked ? [...form.staffIds, member.id] : form.staffIds.filter((id) => id !== member.id))}>{member.name}</Checkbox>)}</div>
                    <p className={styles.help}>全アカウント担当者は追加操作なしで閲覧できます。</p>
                  </fieldset>
                  {optionsError ? <p role="alert" className={styles.fieldError}>{optionsError}</p> : null}
                </div>
              )}
              <div className={styles.field}>
                <span className={styles.groupLabel}>Callback URL</span>
                <div className={styles.endpoint}>
                  <span className={styles.endpointValue} title={callbackUrl}>{callbackUrl}</span>
                  <CopyButton value={callbackUrl} />
                </div>
              </div>
            </section>
          )}

          {currentStep === 4 && !createdId && (
            <div className={styles.split} data-design-node="v2KMj">
              <div className={styles.column}>
                <ol className={styles.checkList} aria-label="接続確認項目">
                  {checkRows.map((row) => <CheckRow key={row.key} row={row} />)}
                </ol>
                <div className={styles.importBox}>
                  <Toggle checked={form.importFriends} label="既存の友だちの取り込み" onChange={(next) => update('importFriends', next)} />
                  <span className={styles.importText}>
                    <strong>既存の友だちの取り込み</strong>
                    <span>登録のあと、いまの友だちを musubo に取り込みます（数分かかります）</span>
                  </span>
                </div>
              </div>
              <aside className={styles.aside} aria-label="登録内容を確認する">
                <h2>登録内容を確認する</h2>
                <p>{`表示名：${form.name.trim() || (connection?.displayName ? `${connection.displayName}（LINEから取得）` : 'LINEから取得')}`}</p>
                <p>{`LINE ID：${form.lineId || '接続確認で取得します'}`}</p>
                <p>{`親アカウント：${parentName ?? 'なし'}`}</p>
                <p>{`タグ：${selectedTags.length > 0 ? selectedTags.map((tag) => tag.name).join('・') : 'なし'}`}</p>
                <p>{`担当：${staffNames.length > 0 ? staffNames.join('・') : 'なし'}`}</p>
              </aside>
            </div>
          )}

          {createdId && connection && (
            <section className={styles.panel} aria-label="登録完了" data-design-node="TvXII">
              <h2 className={styles.panelTitle}>登録が完了しました</h2>
              <p className={styles.doneLine}>
                <CircleCheck size={18} aria-hidden="true" />
                {`${(connection.displayName ?? form.name.trim()) || 'LINEアカウント'}${connection.basicId ? `（${connection.basicId}）` : ''}を登録しました`}
              </p>
              <div className={styles.progressBox}>
                {connection.followerImport.capability === 'available' && form.importFriends ? <>
                  <div className={styles.progressHead}>
                    <strong>{importingIds ? '既存の友だちを取り込んでいます' : '既存の友だちを取り込みました'}</strong>
                    <strong>{importingIds ? `${importedCount.toLocaleString('ja-JP')}人 / ${progressTotal !== null ? `${progressTotal.toLocaleString('ja-JP')}人` : '確認中'}` : `${importedCount.toLocaleString('ja-JP')}人`}</strong>
                  </div>
                  <div className={styles.progressTrack} role="progressbar" aria-valuenow={progressRate} aria-valuemin={0} aria-valuemax={100} aria-label="友だちの取り込み">
                    <span className={styles.progressFill} style={{ width: `${progressRate}%` }} />
                  </div>
                  <p className={styles.progressWarn}>この画面を開いている間に取り込みます。閉じると止まり、もう一度開くと続きから取り込みます。</p>
                </> : connection.followerImport.capability === 'available' ? (
                  <p className={styles.progressNote}>既存の友だちの取り込みはオフになっています。取り込むときはアカウントの詳細から始めてください。</p>
                ) : null}
                <p className={styles.progressNote}>LINE の都合で取り込めないアカウントでは、友だちが話しかけた順に登録されます。</p>
              </div>
              {connection.remainingActions.length > 0 && (
                <div className={styles.noteBox}>
                  <p><strong>残りの手作業</strong></p>
                  <ul>{connection.remainingActions.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              )}
              <p className={styles.groupLabel}>次にすること</p>
              <div className={styles.buttonRow}>
                <Button href={`/accounts/detail?id=${encodeURIComponent(createdId)}`}><ArrowUpRight size={15} aria-hidden="true" />登録したアカウントを見る</Button>
                <Button href="/friends"><Users size={15} aria-hidden="true" />友だち一覧</Button>
                <Button href="/friend-add-settings"><QrCode size={15} aria-hidden="true" />友だち追加URL・QR</Button>
                <Button href="/emergency"><Activity size={15} aria-hidden="true" />運用状態の接続監視</Button>
              </div>
            </section>
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

        <div className={styles.footer}>
          {createdId ? (
            <Button href="/hq" variant="primary"><ArrowLeft size={15} aria-hidden="true" />統括コンソールへ戻る</Button>
          ) : currentStep === 4 ? <>
            <Button type="button" disabled={busy} onClick={() => { setError(''); setCurrentStep(3) }}><ArrowLeft size={15} aria-hidden="true" />戻る</Button>
            <Button type="button" variant="primary" disabled={busy} onClick={() => void runCheckThenReview()} busy={busyAction === 'check'} busyLabel="接続して設定しています…"><Plug size={15} aria-hidden="true" />接続して設定する</Button>
          </> : <>
            {currentStep === 1
              ? <Button href="/hq">キャンセル</Button>
              : <Button type="button" disabled={busy} onClick={() => { setError(''); setCurrentStep((currentStep - 1) as StepNumber) }}><ArrowLeft size={15} aria-hidden="true" />戻る</Button>}
            <Button type="submit" variant="primary" disabled={busy}><ArrowRight size={15} aria-hidden="true" />次へ</Button>
          </>}
        </div>
      </form>

      <NoticeLineRegisterDialog open={noticeDialog === 'open'} onClose={() => setNoticeDialog('done')} />
      {stepUp && <StepUpPrompt request={stepUp} onDone={() => setStepUp(null)} onClose={() => setStepUp(null)} />}

      <Dialog
        open={resultOpen}
        onCancel={() => setResultOpen(false)}
        title="接続を確かめた結果"
        designNode="qw80E"
        designWidth={640}
        designTop={180}
        footer={<div className={styles.dialogFooter}>
          <Button type="button" disabled={busy} onClick={() => void runCheckThenReview()} busy={busyAction === 'check'} busyLabel="調べています…"><RotateCw size={15} aria-hidden="true" />もう一度調べる</Button>
          <Button type="button" variant="primary" disabled={!rowsPassed || !manualAck || busy} onClick={() => void save()} busy={busyAction === 'save'} busyLabel="登録しています…"><ShieldCheck size={15} aria-hidden="true" />確認コードを入れて登録する</Button>
        </div>}
      >
        <div className={styles.result}>
          <p className={styles.resultLead}>自動で調べた 4 項目と、LINE の画面で手で確かめる 1 項目があります。</p>
          <table className={styles.resultTable}>
            <tbody>
              <ResultRow label="チャネルアクセストークン" value={checkRows[0].state === 'passed' ? '正しく読めました' : '読み取れませんでした'} state={checkRows[0].state} />
              <ResultRow label="Webhook の URL" value={checkRows[2].state === 'passed' ? 'musubo の受け口へ届きました' : webhookDetail(connection?.verification?.webhook, checkRows[2].state !== 'todo', false)} state={checkRows[2].state} />
              <ResultRow label="Webhook の利用" value={checkRows[2].state === 'passed' ? 'LINE 側で「オン」でした' : 'まだ確かめていません'} state={checkRows[2].state} />
              <ResultRow
                label="ボットの情報"
                value={connection?.displayName ? `表示名「${connection.displayName}」${connection.verification?.followerTotal != null ? `・友だち ${connection.verification.followerTotal.toLocaleString('ja-JP')} 人` : ''}` : 'まだ確かめていません'}
                state={!connection ? 'todo' : connection.displayName ? 'passed' : 'failed'}
              />
              <tr>
                <td className={styles.resultLabel}>応答メッセージ</td>
                <td>API では調べられません</td>
                <td><StatusBadge tone="neutral">手動で確かめる</StatusBadge></td>
              </tr>
            </tbody>
          </table>
          <div className={styles.manualAck}>
            <Checkbox checked={manualAck} onCheckedChange={setManualAck}>LINE Official Account Manager で「応答メッセージ」をオフにしたことを確かめました</Checkbox>
          </div>
          {!rowsPassed && <Notice tone="warn" message="止まった項目を直して、もう一度調べます。手動の1項目にチェックを入れても登録はできません。" />}
        </div>
      </Dialog>
    </PageFrame>
  )
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      {children}
      {error ? <p className={styles.fieldError}>{error}</p> : null}
    </div>
  )
}

function CheckRow({ row }: { row: V8CheckRow }) {
  const Icon = row.state === 'passed' ? CircleCheck : row.state === 'failed' ? CircleX : CircleDashed
  return (
    <li className={styles.checkRow} data-state={row.state}>
      <Icon size={18} className={styles.checkIcon} aria-hidden="true" />
      <strong className={styles.checkTitle}>{row.title}</strong>
      <span className={styles.checkDetail} title={row.message ?? row.detail}>{row.state === 'failed' && row.message ? `${row.detail}（${row.message}）` : row.detail}</span>
      <StatusBadge tone={row.state === 'passed' ? 'success' : row.state === 'failed' ? 'neutral' : 'warning'}>
        {row.state === 'passed' ? '通った' : row.state === 'failed' ? '止まった' : 'まだ'}
      </StatusBadge>
    </li>
  )
}

function ResultRow({ label, value, state }: { label: string; value: string; state: 'passed' | 'failed' | 'todo' }) {
  return (
    <tr>
      <td className={styles.resultLabel}>{label}</td>
      <td>{value}</td>
      <td><StatusBadge tone={state === 'passed' ? 'success' : 'neutral'}>{state === 'todo' ? 'まだ' : state === 'passed' ? '通った' : '止まった'}</StatusBadge></td>
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
    <Button type="button" onClick={() => void copy()} disabled={value === '—'}>
      <Copy size={15} aria-hidden="true" />{copied ? 'コピー済み' : 'コピー'}
    </Button>
  )
}
