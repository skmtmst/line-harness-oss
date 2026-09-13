'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import Image from 'next/image'
import { api, type FollowerImportState, type LineAccountConnectData } from '@/lib/api'
import Button from '@/components/shared/button'
import PageHeader from '@/components/shared/page-header'
import StickyBar from '@/components/shared/sticky-bar'
import StatusBadge from '@/components/shared/status-badge'
import { CHECK_STATE_LABEL, canSave, stoppedAt, toSteps } from '../connection-check-view'

const WIZARD_STEPS = [
  { number: 1, label: '基本情報', designNode: 'a8qMXX' },
  { number: 2, label: 'LINE準備', designNode: 'oeVQQ' },
  { number: 3, label: 'チャネル設定', designNode: 'YEHCR' },
  { number: 4, label: '接続確認', designNode: 'K1zHyx' },
  { number: 5, label: '完了', designNode: 'VPh1U' },
] as const

type StepNumber = (typeof WIZARD_STEPS)[number]['number']
type BusyAction = 'check' | 'save' | null
type FieldErrors = Record<string, string>
type FormState = {
  name: string
  channelId: string
  channelSecret: string
  loginChannelId: string
  loginChannelSecret: string
}

const emptyForm: FormState = {
  name: '', channelId: '', channelSecret: '', loginChannelId: '', loginChannelSecret: '',
}

export default function NewLineAccountPage() {
  const [accountMethod, setAccountMethod] = useState<'existing' | 'new'>('existing')
  const [currentStep, setCurrentStep] = useState<StepNumber>(1)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [connection, setConnection] = useState<LineAccountConnectData | null>(null)
  const [importState, setImportState] = useState<FollowerImportState | null>(null)
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [error, setError] = useState('')
  const busyLock = useRef(false)
  const stepPanelRef = useRef<HTMLDivElement>(null)

  const steps = useMemo(() => toSteps(connection ? { steps: connection.steps } : null), [connection])
  const stopped = stoppedAt(steps)
  const connectionPassed = Boolean(connection && canSave(steps))
  const createdId = connection?.id ?? ''
  const workerBase = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
  const callbackUrl = workerBase ? `${workerBase}/auth/callback` : '—'
  const importingIds = (importState?.phase ?? connection?.followerImport.phase) === 'importing_ids'

  useEffect(() => { stepPanelRef.current?.focus() }, [currentStep])

  useEffect(() => {
    if (!createdId || !importingIds) return
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
  }, [createdId, importingIds])

  const update = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
    setFieldErrors((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
    setConnection(null)
    setError('')
  }

  const validateStep = (step: StepNumber) => {
    const nextErrors = getStepErrors(step, form)
    setFieldErrors((current) => ({ ...current, ...nextErrors }))
    return Object.keys(nextErrors).length === 0
  }

  const moveNext = () => {
    if (currentStep <= 3 && !validateStep(currentStep)) {
      setError('入力内容を確認してください。')
      return
    }
    setError('')
    if (currentStep < 4) setCurrentStep((currentStep + 1) as StepNumber)
  }

  const input = () => ({
    name: form.name.trim() || undefined,
    channelId: form.channelId.trim(),
    channelSecret: form.channelSecret,
    loginChannelId: form.loginChannelId.trim(),
    loginChannelSecret: form.loginChannelSecret,
  })

  const checkConnection = async () => {
    const nextErrors = getStepErrors(3, form)
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors((current) => ({ ...current, ...nextErrors }))
      setCurrentStep(3)
      setError('接続に必要な4項目を確認してください。')
      return
    }
    if (busyLock.current) return
    busyLock.current = true
    setBusyAction('check')
    setConnection(null)
    setError('')
    try {
      const response = await api.lineAccounts.connectCheck(input())
      if (!response.success) {
        setError(response.error)
        return
      }
      setConnection(response.data)
      if (!canSave(response.data.steps)) {
        setError('止まった項目を直して、もう一度「接続して設定する」を押してください。')
      }
    } catch {
      setError('LINEに接続できませんでした。時間をおいて、もう一度お試しください。')
    } finally {
      busyLock.current = false
      setBusyAction(null)
    }
  }

  const save = async () => {
    if (!connectionPassed || busyLock.current) {
      setError('5段すべて通ってから保存してください。')
      return
    }
    busyLock.current = true
    setBusyAction('save')
    setError('')
    try {
      const response = await api.lineAccounts.connect(input())
      if (!response.success) {
        setError(response.error)
        return
      }
      setConnection(response.data)
      setForm((current) => ({ ...current, channelSecret: '', loginChannelSecret: '' }))
      setCurrentStep(5)
    } catch {
      setError('登録できませんでした。DBには保存していません。時間をおいて、もう一度お試しください。')
    } finally {
      busyLock.current = false
      setBusyAction(null)
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (currentStep === 4) void save()
    else moveNext()
  }

  const review = (
    <div className="space-y-4">
      <ReviewGroup title="基本情報"><ReviewRow label="表示名" value={form.name.trim() || 'LINEから取得'} /></ReviewGroup>
      <ReviewGroup title="Messaging API"><ReviewRow label="チャネルID" value={form.channelId.trim()} /><SecretReviewRow label="チャネルシークレット" /></ReviewGroup>
      <ReviewGroup title="LINE Login"><ReviewRow label="LoginチャネルID" value={form.loginChannelId.trim()} /><SecretReviewRow label="Loginチャネルシークレット" /></ReviewGroup>
    </div>
  )

  return (
    <div data-design-node="b2NGxk" className="mx-auto w-full max-w-6xl pb-24">
      <div data-design="Head">
        <div className="mb-4 flex justify-end"><Button href="/hq">統括コンソールへ戻る</Button></div>
        <PageHeader
          breadcrumb={[{ label: 'LINEアカウント', href: '/accounts' }, { label: '登録' }]}
          title="LINEアカウントを登録"
          description="4つのチャネル情報を入力すると、接続設定と既存友だちの取り込みを自動で行います。"
        />
      </div>

      <nav data-design="Steps" aria-label="登録の進捗" className="bg-canvas rounded-card border-hairline mb-4 border p-4">
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-5">
          {WIZARD_STEPS.map((step) => {
            const active = currentStep === step.number
            const complete = currentStep > step.number || Boolean(createdId)
            return <li key={step.number} aria-current={active ? 'step' : undefined} className={`rounded-control border px-3 py-2 ${active ? 'border-action bg-action-soft' : 'border-hairline'}`}>
              <span className="text-ink-faint block text-xs">手順 {step.number} / 5</span>
              <span className="text-ink mt-0.5 block text-xs font-bold">{step.label}{complete ? '（完了）' : ''}</span>
            </li>
          })}
        </ol>
      </nav>

      <form onSubmit={submit} noValidate aria-busy={busyAction ? true : undefined}>
        <div data-design="Body" ref={stepPanelRef} tabIndex={-1} className="outline-none">
          {currentStep === 1 && <div data-design-node="a8qMXX">
            <SetupSection title="1. 基本情報" description="管理画面で見分ける名前を設定します。未入力でも登録できます。">
              <Field id="account-name" label="表示名（任意）" value={form.name} onChange={(value) => update('name', value)} placeholder="未入力なら LINE公式アカウントの名前をそのまま使います" error={fieldErrors.name} />
            </SetupSection>
          </div>}

          {currentStep === 2 && <div data-design-node="oeVQQ">
            <SetupSection title="2. LINE側の準備" description="登録するLINE公式アカウントの用意方法を選びます。">
              <fieldset>
                <legend className="text-ink-secondary mb-2 text-xs font-medium">アカウントの用意方法</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Choice checked={accountMethod === 'existing'} onChange={() => setAccountMethod('existing')} label="既存の公式アカウントを使う" />
                  <Choice checked={accountMethod === 'new'} onChange={() => setAccountMethod('new')} label="新しく公式アカウントを作成" />
                </div>
              </fieldset>
              {accountMethod === 'new' && <div className="rounded-control border-hairline border p-4 text-sm">
                <p className="text-ink-secondary mb-3">LINE公式アカウントを作成してから、同じプロバイダー内にMessaging APIとLINE Loginのチャネルを用意します。</p>
                <a href="https://manager.line.biz/" target="_blank" rel="noreferrer" className="text-action font-semibold hover:underline">LINE公式アカウントを作る（LINE Official Account Manager）</a>
              </div>}
              <a href="https://developers.line.biz/console/" target="_blank" rel="noreferrer" className="text-action inline-block text-sm font-semibold hover:underline">LINE Developersを開く</a>
            </SetupSection>
          </div>}

          {currentStep === 3 && <div data-design-node="YEHCR" className="grid gap-4 lg:grid-cols-2">
            <SetupSection title="Messaging API" description="アクセストークンはmusuboが自動で発行します。" action={<ManualLink anchor="m1" label="取得方法を見る" />}>
              <Field id="channel-id" label="チャネルID" value={form.channelId} onChange={(value) => update('channelId', value)} inputMode="numeric" required error={fieldErrors.channelId} />
              <Field id="channel-secret" label="チャネルシークレット" value={form.channelSecret} onChange={(value) => update('channelSecret', value)} type="password" required error={fieldErrors.channelSecret} />
            </SetupSection>
            <SetupSection title="LINE Login" description="LIFFは自動で作成します。Messaging APIと同じプロバイダーのチャネルを入力してください。" action={<ManualLink anchor="m2" label="取得方法を見る" />}>
              <Field id="login-channel-id" label="LoginチャネルID" value={form.loginChannelId} onChange={(value) => update('loginChannelId', value)} inputMode="numeric" required error={fieldErrors.loginChannelId} />
              <Field id="login-channel-secret" label="Loginチャネルシークレット" value={form.loginChannelSecret} onChange={(value) => update('loginChannelSecret', value)} type="password" required error={fieldErrors.loginChannelSecret} />
            </SetupSection>
          </div>}

          {currentStep === 4 && <div data-design-node="K1zHyx" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="space-y-4">
              <SetupSection title="4. LINE側の設定" description="LINE LoginチャネルへCallback URLを登録してください。" action={<ManualLink anchor="m3" label="設定方法を見る" />}>
                <EndpointRow label="Callback URL" value={callbackUrl} help="LINE Login → Callback URL" />
              </SetupSection>
              <SetupSection title="接続確認" description="上から順に自動設定します。止まった段だけ直して再実行してください。">
                <ol className="space-y-2" aria-label="接続確認項目">
                  {steps.map((item) => <li key={item.order} className="border-hairline rounded-control flex items-start gap-3 border p-3">
                    <span className="text-ink-faint w-4 shrink-0 text-xs tabular-nums">{item.order}</span>
                    <span className="text-ink min-w-0 flex-1 text-xs leading-relaxed">{item.message}</span>
                    <StatusBadge tone={item.state === 'passed' ? 'success' : item.state === 'failed' ? 'warning' : 'neutral'}>{CHECK_STATE_LABEL[item.state]}</StatusBadge>
                  </li>)}
                </ol>
                {stopped && <p role="alert" className="bg-warning-bg text-warning rounded-control p-3 text-xs leading-relaxed">{stopped.message}</p>}
                {connectionPassed && <p role="status" className="bg-success-bg text-success rounded-control p-3 text-xs">5段すべて通りました。保存できます。</p>}
                <Button type="button" variant="primary" disabled={Boolean(busyAction)} onClick={() => void checkConnection()}>{busyAction === 'check' ? '接続して設定しています…' : '接続して設定する'}</Button>
              </SetupSection>
            </div>
            <aside className="space-y-4" aria-label="設定時の補足">
              <details className="rounded-card border border-hairline bg-canvas p-5"><summary className="cursor-pointer text-sm font-bold text-ink">登録内容を確認する</summary><div className="mt-4">{review}</div></details>
              <InfoSection title="つながる先"><ul className="space-y-2"><li>友だち追加URL・QR</li><li>ログインユーザーの担当範囲</li><li>運用状態の接続監視</li><li>友だち一覧</li></ul></InfoSection>
              <InfoSection title="気をつけること"><ul className="space-y-2"><li>Messaging APIとLINE Loginは同じプロバイダーで作成してください。</li><li>Webhookの利用はLINE Developersでオンにしてください。</li><li>秘密値は保存後に画面へ表示されません。</li><li>接続確認が5段すべて通るまで登録しません。</li></ul></InfoSection>
            </aside>
          </div>}

          {currentStep === 5 && connection && <div data-design-node={importingIds ? 'VPh1U' : 't3Mlu'}>
            <SetupSection title="登録が完了しました" description="LINEアカウントの接続設定を自動で完了しました。">
              {importingIds ? <p role="status" className="bg-action-soft text-action rounded-control p-4 text-sm">認証済みアカウントのため、既存の友だちを取り込んでいます（{importState?.received ?? 0}人 / 確認中）。取り込みが終わるまで、この画面でお待ちください。</p> : <p role="status" className="bg-success-bg text-success rounded-control p-4 text-sm">登録が完了しました</p>}
              <ReviewGroup title="LINEアカウント">
                <ReviewRow label="表示名" value={`${connection.displayName ?? form.name}（LINEから取得）`} />
                <ReviewRow label="LINE ID" value={connection.basicId ?? '取得できませんでした'} />
                <ReviewRow label="認証状態" value={connection.followerImport.capability === 'available' ? '認証済み' : '未認証'} />
                <ReviewRow label="LIFF ID" value={`${connection.liffId ?? '—'}（自動作成）`} />
                <ReviewRow label="既存の友だちの取り込み" value={connection.followerImport.capability === 'available' ? `${importState?.imported ?? 0}人` : '未認証のため、友だちは操作があった順に登録されます'} />
              </ReviewGroup>
              {connection.pictureUrl && <Image src={connection.pictureUrl} alt="LINE公式アカウントのアイコン" width={64} height={64} unoptimized className="h-16 w-16 rounded-full object-cover" />}
              {connection.remainingActions.length > 0 && <InfoSection title="残りの手作業"><ul className="space-y-2">{connection.remainingActions.map((item) => <li key={item}>{item}</li>)}</ul></InfoSection>}
            </SetupSection>
          </div>}
        </div>

        {error && <p role="alert" aria-live="assertive" className="bg-danger-bg text-danger rounded-control mt-4 p-3 text-sm">{error}</p>}
        <div data-design="Actions">
          <StickyBar
            className="mt-4"
            status={createdId ? (importingIds ? '既存の友だちを取り込んでいます' : '登録が完了しました') : busyAction === 'save' ? '接続して保存しています' : `手順 ${currentStep} / 5`}
            actions={createdId ? <>
              {importingIds ? <><Button type="button" disabled>登録したアカウントを見る</Button><Button type="button" variant="primary" disabled>統括コンソールへ</Button></> : <><Button href={`/accounts/detail?id=${encodeURIComponent(createdId)}`}>登録したアカウントを見る</Button><Button href="/hq" variant="primary">統括コンソールへ</Button></>}
            </> : <>
              <Button href="/accounts">やめる</Button>
              {currentStep > 1 && <Button type="button" disabled={Boolean(busyAction)} onClick={() => { setError(''); setCurrentStep((currentStep - 1) as StepNumber) }}>戻る</Button>}
              <Button type="submit" variant="primary" disabled={Boolean(busyAction) || (currentStep === 4 && !connectionPassed)}>{currentStep === 4 ? busyAction === 'save' ? '接続して保存しています…' : '接続して保存' : '次へ'}</Button>
            </>}
          />
        </div>
      </form>
    </div>
  )
}

function getStepErrors(step: StepNumber, form: FormState): FieldErrors {
  const errors: FieldErrors = {}
  if (step === 1 && form.name.trim().length > 40) errors.name = '表示名は40文字以内で入力してください。'
  if (step === 3) {
    if (!form.channelId.trim()) errors.channelId = 'チャネルIDを入力してください。'
    else if (!/^\d+$/.test(form.channelId.trim())) errors.channelId = 'チャネルIDは半角数字で入力してください。'
    if (!form.channelSecret) errors.channelSecret = 'チャネルシークレットを入力してください。'
    if (!form.loginChannelId.trim()) errors.loginChannelId = 'LoginチャネルIDを入力してください。'
    else if (!/^\d+$/.test(form.loginChannelId.trim())) errors.loginChannelId = 'LoginチャネルIDは半角数字で入力してください。'
    if (!form.loginChannelSecret) errors.loginChannelSecret = 'Loginチャネルシークレットを入力してください。'
  }
  return errors
}

function SetupSection({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return <section className="bg-canvas rounded-card border-hairline border p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="text-ink text-base font-bold">{title}</h2><p className="text-ink-secondary mt-1 text-xs leading-relaxed">{description}</p></div>{action}</div><div className="mt-4 space-y-4">{children}</div></section>
}

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="bg-canvas rounded-card border-hairline border p-5"><h3 className="text-ink text-sm font-bold">{title}</h3><div className="text-ink-secondary mt-3 text-xs leading-relaxed">{children}</div></section>
}

function ManualLink({ anchor, label }: { anchor: 'm1' | 'm2' | 'm3'; label: string }) {
  return <a href={`/manuals/line-connect/index.html#${anchor}`} target="_blank" rel="noreferrer" className="text-action shrink-0 text-xs font-semibold hover:underline">{label}</a>
}

function Choice({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <label className="rounded-control border-hairline flex cursor-pointer items-center gap-3 border p-4 text-sm text-ink"><input type="radio" name="account-method" checked={checked} onChange={onChange} />{label}</label>
}

function Field({ id, label, value, onChange, placeholder, required = false, type = 'text', inputMode, error }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean; type?: 'text' | 'password'; inputMode?: 'text' | 'numeric'; error?: string }) {
  const errorId = `${id}-error`
  return <label className="block" htmlFor={id}><span className="text-ink-secondary mb-1 block text-xs font-medium">{label}{required && <span className="text-danger ml-1">必須</span>}</span><input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} inputMode={inputMode} autoComplete={type === 'password' ? 'new-password' : undefined} spellCheck={type === 'password' ? false : undefined} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} className="border-hairline rounded-control text-ink w-full border px-3 py-2 text-sm" />{error && <span id={errorId} className="text-danger mt-1 block text-xs">{error}</span>}</label>
}

function EndpointRow({ label, value, help }: { label: string; value: string; help: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => { if (value === '—') return; try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1200) } catch { /* 表示値を選択してコピーできる。 */ } }
  return <div><p className="text-ink-faint text-xs font-medium">{label}</p><div className="mt-1 flex items-stretch gap-2"><p className="bg-canvas-sunken rounded-control text-ink min-w-0 flex-1 select-all break-all px-3 py-2 text-xs leading-relaxed">{value}</p><Button type="button" onClick={() => void copy()} disabled={value === '—'} className="shrink-0">{copied ? 'コピー済み' : 'コピー'}</Button></div><p className="text-ink-faint mt-1 text-xs">{help}</p></div>
}

function ReviewGroup({ title, children }: { title: string; children: ReactNode }) { return <section className="border-hairline rounded-control border p-4"><h3 className="text-ink text-sm font-bold">{title}</h3><dl className="mt-3 divide-y divide-hairline">{children}</dl></section> }
function ReviewRow({ label, value }: { label: string; value: string }) { return <div className="grid gap-1 py-2 sm:grid-cols-3"><dt className="text-ink-faint text-xs">{label}</dt><dd className="text-ink break-all text-sm sm:col-span-2">{value}</dd></div> }
function SecretReviewRow({ label }: { label: string }) { return <ReviewRow label={label} value="入力済み（安全のため表示しません）" /> }
