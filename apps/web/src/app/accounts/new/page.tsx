'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '@/lib/api'
import type { LineAccount } from '@line-crm/shared'
import Button from '@/components/shared/button'
import PageHeader from '@/components/shared/page-header'
import Select from '@/components/shared/select'
import StickyBar from '@/components/shared/sticky-bar'
import StatusBadge from '@/components/shared/status-badge'
import { emptyAccountFormState, type AccountFormState } from '@/components/accounts/account-form-fields'
import {
  CHECK_STATE_LABEL,
  canSave,
  stoppedAt,
  toSteps,
  type VerifyResult,
} from '../connection-check-view'

const WIZARD_STEPS = [
  { number: 1, label: '基本情報' },
  { number: 2, label: 'LINE準備' },
  { number: 3, label: 'チャネル設定' },
  { number: 4, label: '接続確認' },
  { number: 5, label: '完了' },
] as const

type StepNumber = (typeof WIZARD_STEPS)[number]['number']
type BusyAction = 'verify' | 'save' | null
type FieldErrors = Record<string, string>

/** LINEアカウントを、接続を確かめてから登録する5段階フロー。 */
export default function NewLineAccountPage() {
  const [prepared, setPrepared] = useState<string[]>([])
  const [accountMethod, setAccountMethod] = useState('existing')
  const [currentStep, setCurrentStep] = useState<StepNumber>(1)
  const [form, setForm] = useState<AccountFormState>(emptyAccountFormState)
  const [timezone, setTimezone] = useState('Asia/Tokyo')
  const [country, setCountry] = useState('日本')
  const [role, setRole] = useState('')
  const [parentLineAccountId, setParentLineAccountId] = useState('')
  const [parentAccounts, setParentAccounts] = useState<LineAccount[]>([])
  const [verify, setVerify] = useState<VerifyResult | null>(null)
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [error, setError] = useState('')
  const [createdId, setCreatedId] = useState('')
  const busyLock = useRef(false)
  const stepPanelRef = useRef<HTMLDivElement>(null)

  const steps = useMemo(() => toSteps(verify), [verify])
  const stopped = stoppedAt(steps)
  const connectionPassed = Boolean(verify && canSave(steps))
  const workerBase = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
  const webhookUrl = workerBase ? `${workerBase}/webhook` : '—'
  const callbackUrl = workerBase ? `${workerBase}/auth/callback` : '—'
  const liffEndpointUrl = workerBase && form.liffId.trim()
    ? `${workerBase}?liffId=${encodeURIComponent(form.liffId.trim())}`
    : 'LIFF IDを入力すると表示します'
  const parentName = parentAccounts.find((account) => account.id === parentLineAccountId)?.name ?? '設定しない'

  useEffect(() => {
    let active = true
    void api.lineAccounts.list().then((response) => {
      if (active && response.success) {
        setParentAccounts(response.data.filter((account) => !account.archivedAt))
      }
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  useEffect(() => {
    stepPanelRef.current?.focus()
  }, [currentStep])

  const clearFieldError = (key: string) => {
    setFieldErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const invalidateConnection = () => {
    setVerify(null)
    setError('')
  }

  const update = (key: keyof AccountFormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
    clearFieldError(key)
    invalidateConnection()
  }

  const updateMetadata = (
    key: 'timezone' | 'country' | 'role' | 'parentLineAccountId',
    value: string,
  ) => {
    if (key === 'timezone') setTimezone(value)
    if (key === 'country') setCountry(value)
    if (key === 'role') setRole(value)
    if (key === 'parentLineAccountId') setParentLineAccountId(value)
    clearFieldError(key)
    invalidateConnection()
  }

  const validateStep = (step: StepNumber) => {
    const nextErrors = getStepErrors(step, form, timezone)
    setFieldErrors((current) => ({ ...current, ...nextErrors }))
    return Object.keys(nextErrors).length === 0
  }

  const moveNext = () => {
    setError('')
    if (currentStep <= 3 && !validateStep(currentStep)) {
      setError('入力内容を確認してください。')
      return
    }
    if (currentStep < 5) setCurrentStep((currentStep + 1) as StepNumber)
  }

  const moveBack = () => {
    if (currentStep <= 1 || busyLock.current) return
    setError('')
    setCurrentStep((currentStep - 1) as StepNumber)
  }

  const checkConnection = async () => {
    const nextErrors = getStepErrors(3, form, timezone)
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors((current) => ({ ...current, ...nextErrors }))
      setCurrentStep(3)
      setError('接続確認に必要な入力内容を確認してください。')
      return
    }
    if (busyLock.current) return

    busyLock.current = true
    setBusyAction('verify')
    setError('')
    setVerify(null)
    try {
      const checked = await api.lineAccounts.verifyConnection({
        channelAccessToken: form.channelAccessToken,
        loginChannelId: form.loginChannelId.trim(),
        loginChannelSecret: form.loginChannelSecret,
        liffId: form.liffId.trim(),
      })
      if (!checked.success) {
        setError('接続を確認できませんでした。入力内容とLINE Developersの設定を確認してください。')
        return
      }
      setVerify(checked.data)
      if (!canSave(toSteps(checked.data))) {
        setError('接続確認で止まった項目があります。設定を直して、もう一度確かめてください。')
      }
    } catch {
      setError('接続を確認できませんでした。しばらくおいてから、もう一度お試しください。')
    } finally {
      busyLock.current = false
      setBusyAction(null)
    }
  }

  const verifyAndSave = async () => {
    const allErrors = {
      ...getStepErrors(1, form, timezone),
      ...getStepErrors(3, form, timezone),
    }
    if (Object.keys(allErrors).length > 0) {
      setFieldErrors((current) => ({ ...current, ...allErrors }))
      const firstInvalidStep = Object.keys(getStepErrors(1, form, timezone)).length > 0
        ? 1
        : 3
      setCurrentStep(firstInvalidStep)
      setError('入力内容を確認してください。')
      return
    }
    if (busyLock.current) return

    busyLock.current = true
    setBusyAction('save')
    setError('')
    setVerify(null)
    try {
      // 保存直前にも再確認し、失敗または途中停止なら create は呼ばない。
      const checked = await api.lineAccounts.verifyConnection({
        channelAccessToken: form.channelAccessToken,
        loginChannelId: form.loginChannelId.trim(),
        loginChannelSecret: form.loginChannelSecret,
        liffId: form.liffId.trim(),
      })
      if (!checked.success) {
        setError('接続を確認できなかったため、保存していません。設定を確認してください。')
        return
      }
      setVerify(checked.data)
      if (!canSave(toSteps(checked.data))) {
        setError('接続確認で止まったため、保存していません。前の手順に戻って設定を確認してください。')
        return
      }

      const created = await api.lineAccounts.create({
        channelId: form.channelId.trim(),
        name: form.name.trim(),
        channelAccessToken: form.channelAccessToken,
        channelSecret: form.channelSecret,
        loginChannelId: form.loginChannelId.trim(),
        loginChannelSecret: form.loginChannelSecret,
        liffId: form.liffId.trim(),
        timezone,
        country: country || null,
        role: role || null,
        parentLineAccountId: parentLineAccountId || null,
      })
      if (!created.success) {
        setError('接続は確認できましたが、登録できませんでした。しばらくおいてから、もう一度お試しください。')
        return
      }
      setCreatedId(created.data.id)
      setForm(current => ({ ...current, channelSecret: '', channelAccessToken: '', loginChannelSecret: '' }))
      setCurrentStep(5)
    } catch {
      setError('登録できませんでした。しばらくおいてから、もう一度お試しください。')
    } finally {
      busyLock.current = false
      setBusyAction(null)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (createdId || busyLock.current) return
    if (currentStep === 4) {
      if (!connectionPassed) {
        setError('接続確認がすべて通ってから登録してください。')
        return
      }
      void verifyAndSave()
      return
    }
    moveNext()
  }

  const accountSummary = (
    <div className="space-y-4">
              <ReviewGroup title="基本情報">
                <ReviewRow label="表示名" value={form.name.trim()} />
                <ReviewRow label="国・地域" value={country.trim() || '設定しない'} />
                <ReviewRow label="役割メモ" value={role.trim() || '設定しない'} />
                <ReviewRow label="親アカウント" value={parentName} />
                <ReviewRow label="タイムゾーン" value={timezone} />
              </ReviewGroup>
              <ReviewGroup title="Messaging API">
                <ReviewRow label="チャネルID" value={form.channelId.trim()} />
                <SecretReviewRow label="チャネルシークレット" />
                <SecretReviewRow label="チャネルアクセストークン" />
              </ReviewGroup>
              <ReviewGroup title="LINE Login・LIFF">
                <ReviewRow label="LoginチャネルID" value={form.loginChannelId.trim()} />
                <SecretReviewRow label="Loginチャネルシークレット" />
                <ReviewRow label="LIFF ID" value={form.liffId.trim()} />
              </ReviewGroup>
    </div>
  )

  return (
    <div data-design-node="b2NGxk" className="mx-auto w-full max-w-6xl pb-24">
      <div className="mb-4 flex justify-end">
        <Button href="/hq">統括コンソールへ戻る</Button>
      </div>
      <PageHeader
        breadcrumb={[{ label: 'LINEアカウント', href: '/accounts' }, { label: '登録' }]}
        title="LINEアカウントを登録"
        description="5つの手順で設定し、接続を確かめてから保存します。入力内容は前の手順に戻っても保持されます。"
      />

      <nav aria-label="登録の進捗" className="bg-canvas rounded-card border-hairline mb-4 border p-4">
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-5">
          {WIZARD_STEPS.map((step) => {
            const active = currentStep === step.number
            const complete = currentStep > step.number || Boolean(createdId)
            return (
              <li
                key={step.number}
                aria-current={active ? 'step' : undefined}
                className={`rounded-control border px-3 py-2 ${active ? 'border-action bg-action-soft' : 'border-hairline'}`}
              >
                <span className="text-ink-faint block text-xs">手順 {step.number} / 5</span>
                <span className="text-ink mt-0.5 block text-xs font-bold">
                  {step.label}{complete ? '（完了）' : ''}
                </span>
              </li>
            )
          })}
        </ol>
      </nav>

      <form onSubmit={handleSubmit} noValidate aria-busy={busyAction ? true : undefined}>
        <div ref={stepPanelRef} tabIndex={-1} className="outline-none">
          {createdId ? (
            <SetupSection title="登録が完了しました" description="LINEアカウントを登録し、接続確認も完了しました。">
              <p role="status" className="bg-success-bg text-success rounded-control p-4 text-sm">
                登録したアカウントの詳細画面から、運用状態を確認できます。
              </p>
              {accountSummary}
            </SetupSection>
          ) : currentStep === 1 ? (
            <SetupSection
              title="1. 基本情報"
              description="管理画面で見分ける名前と、運用上の位置づけを設定します。"
            >
              <Field
                id="account-name"
                label="表示名"
                value={form.name}
                onChange={(value) => update('name', value)}
                placeholder="例：然-NEN- 本店"
                required
                error={fieldErrors.name}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  id="account-timezone"
                  label="タイムゾーン"
                  value={timezone}
                  onChange={(value) => updateMetadata('timezone', value)}
                  options={[
                    { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
                    { value: 'Asia/Ho_Chi_Minh', label: 'Asia/Ho_Chi_Minh' },
                  ]}
                  required
                  error={fieldErrors.timezone}
                />
                <Field
                  id="account-country"
                  label="国・地域（任意）"
                  value={country}
                  onChange={(value) => updateMetadata('country', value)}
                  placeholder="例：日本"
                />
              </div>
              <Field
                id="account-role"
                label="役割メモ（任意）"
                value={role}
                onChange={(value) => updateMetadata('role', value)}
                placeholder="例：検証用。本番の配信には使わない"
              />
              <SelectField
                id="parent-line-account"
                label="親アカウント（任意）"
                value={parentLineAccountId}
                onChange={(value) => updateMetadata('parentLineAccountId', value)}
                options={[
                  { value: '', label: '設定しない' },
                  ...parentAccounts.map((account) => ({ value: account.id, label: account.name })),
                ]}
              />
            </SetupSection>
          ) : currentStep === 2 ? (
            <SetupSection title="2. LINE側の準備を確認" description="LINE側で準備するものを確認します。チェックは手順のメモで、接続できたことを意味しません。">
              <SelectField id="account-method" label="アカウントの用意方法" value={accountMethod} onChange={setAccountMethod} options={[
                { value: 'existing', label: '既存の公式アカウントを接続' },
                { value: 'new', label: '新しく公式アカウントを作成' },
              ]} />
              <p className="text-ink-secondary text-sm">{accountMethod === 'new' ? 'LINE側で公式アカウントを作成してから、この画面へ戻ってください。' : '接続する公式アカウントの管理権限を確認してください。'}</p>
              <ul className="space-y-3">{[
                'LINE公式アカウントを用意',
                'LINE DevelopersでProviderを確認',
                'Messaging APIチャネルを用意',
                'LINE LoginチャネルとLIFFを用意',
              ].map(label => <li key={label} className="rounded-control border border-hairline p-4">
                <label className="flex items-center gap-3 text-sm text-ink">
                  <input type="checkbox" checked={prepared.includes(label)} onChange={event => setPrepared(current => event.target.checked ? [...current, label] : current.filter(item => item !== label))} />
                  {label}
                </label>
              </li>)}</ul>
              <a href="https://developers.line.biz/console/" target="_blank" rel="noreferrer" className="text-action text-sm">LINE Developersを開く</a>
              <p className="text-ink-secondary text-xs">チャネル情報は次の画面で入力します。ここまでの入力は、このブラウザの作成画面内でだけ保持しています。</p>
            </SetupSection>
          ) : currentStep === 3 ? (
            <div className="grid gap-4 lg:grid-cols-2">
<SetupSection
              title="Messaging API"
              description="LINE公式アカウントからメッセージを送受信するための必須情報です。"
            >
              <Field
                id="channel-id"
                label="チャネルID"
                value={form.channelId}
                onChange={(value) => update('channelId', value)}
                placeholder="例：123456789"
                inputMode="numeric"
                required
                error={fieldErrors.channelId}
              />
              <Field
                id="channel-secret"
                label="チャネルシークレット"
                value={form.channelSecret}
                onChange={(value) => update('channelSecret', value)}
                type="password"
                required
                error={fieldErrors.channelSecret}
              />
              <Field
                id="channel-access-token"
                label="チャネルアクセストークン"
                value={form.channelAccessToken}
                onChange={(value) => update('channelAccessToken', value)}
                type="password"
                required
                error={fieldErrors.channelAccessToken}
              />
              <p className="bg-warning-bg text-warning rounded-control p-3 text-xs leading-relaxed">
                秘密値は暗号化して保存し、確認画面・完了画面・エラーには表示しません。
              </p>
            </SetupSection>
<SetupSection
              title="LINE Login・LIFF"
              description="LINE LoginとLIFFに使う情報です。3項目すべて必須です。"
            >
              <Field
                id="login-channel-id"
                label="LoginチャネルID"
                value={form.loginChannelId}
                onChange={(value) => update('loginChannelId', value)}
                inputMode="numeric"
                placeholder="例：1234567890"
                required
                error={fieldErrors.loginChannelId}
              />
              <Field
                id="login-channel-secret"
                label="Loginチャネルシークレット"
                value={form.loginChannelSecret}
                onChange={(value) => update('loginChannelSecret', value)}
                type="password"
                required
                error={fieldErrors.loginChannelSecret}
              />
              <Field
                id="liff-id"
                label="LIFF ID"
                value={form.liffId}
                onChange={(value) => update('liffId', value)}
                placeholder="例：2009624792-XXXXXXXX"
                required
                error={fieldErrors.liffId}
              />
            </SetupSection>
            </div>
          ) : currentStep === 4 ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="space-y-4">
                <SetupSection
                  title="4. Webhook・Callback・LIFF設定"
                  description="以下のURLをLINE Developersへ設定してから接続を確かめます。"
                >
                  <EndpointRow label="Webhook URL" value={webhookUrl} help="Messaging API → Webhook URL" />
                  <EndpointRow label="Callback URL" value={callbackUrl} help="LINE Login → Callback URL" />
                  <EndpointRow label="LIFF エンドポイント" value={liffEndpointUrl} help="LIFF → Endpoint URL" />
                  <a
                    className="text-action inline-block text-sm font-semibold hover:underline focus:underline"
                    href="https://developers.line.biz/console/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    LINE Developersを開く（別のタブ）
                  </a>
                </SetupSection>

                <SetupSection
                  title="接続確認"
                  description="順番に接続を確認します。途中で止まった場合は保存できません。"
                >
                  <ol className="space-y-2" aria-label="接続確認項目">
                    {steps.map((step) => (
                      <li key={step.order} className="border-hairline rounded-control flex items-start gap-3 border p-3">
                        <span className="text-ink-faint w-4 shrink-0 text-xs tabular-nums">{step.order}</span>
                        <span className="text-ink min-w-0 flex-1 text-xs leading-relaxed">{step.label}</span>
                        <StatusBadge tone={step.state === 'passed' ? 'success' : step.state === 'failed' ? 'warning' : 'neutral'}>
                          {CHECK_STATE_LABEL[step.state]}
                        </StatusBadge>
                      </li>
                    ))}
                  </ol>
                  {stopped && (
                    <p role="alert" className="bg-warning-bg text-warning rounded-control p-3 text-xs leading-relaxed">
                      {stopped.order}で止まりました。LINE Developersの設定を確認し、もう一度接続を確かめてください。
                    </p>
                  )}
                  {connectionPassed && (
                    <p role="status" className="bg-success-bg text-success rounded-control p-3 text-xs">
                      すべての接続を確認できました。登録できます。
                    </p>
                  )}
                  <Button
                    type="button"
                    variant="primary"
                    disabled={Boolean(busyAction)}
                    onClick={() => void checkConnection()}
                  >
                    {busyAction === 'verify' ? '接続を確かめています…' : '接続を確かめる'}
                  </Button>
                </SetupSection>
              </div>

              <aside className="space-y-4" aria-label="設定時の補足">
                <details className="rounded-card border border-hairline bg-canvas p-5"><summary className="cursor-pointer text-sm font-bold text-ink">登録内容を確認する</summary><div className="mt-4">{accountSummary}</div></details>
                <InfoSection title="つながる先">
                  <ul className="space-y-2">
                    <li>友だち追加URL・QR</li>
                    <li>ログインユーザーの担当範囲</li>
                    <li>運用状態の接続監視</li>
                    <li>友だち一覧</li>
                  </ul>
                </InfoSection>
                <InfoSection title="気をつけること">
                  <ul className="space-y-2">
                    <li>LINE Developers側でWebhookの利用をオンにしてください。</li>
                    <li>Callback URLとLIFFエンドポイントを対応するチャネルへ設定してください。</li>
                    <li>秘密値は保存後に画面で確認できません。</li>
                    <li>接続確認がすべて通るまで登録しません。</li>
                  </ul>
                </InfoSection>
              </aside>
            </div>
          ) : null}
        </div>

        {error && (
          <p role="alert" aria-live="assertive" className="bg-danger-bg text-danger rounded-control mt-4 p-3 text-sm">
            {error}
          </p>
        )}

        <StickyBar
          className="mt-4"
          status={createdId
            ? '登録が完了しました'
            : busyAction === 'save'
              ? '接続を確かめて保存しています'
              : `手順 ${currentStep} / 5`}
          actions={createdId ? (
            <>
              <Button href={`/accounts/detail?id=${encodeURIComponent(createdId)}`}>登録したアカウントを見る</Button>
              <Button href="/accounts" variant="primary">アカウント一覧へ</Button>
            </>
          ) : (
            <>
              {busyAction ? (
                <Button type="button" disabled>やめる</Button>
              ) : (
                <Button href="/accounts">やめる</Button>
              )}
              {currentStep > 1 && (
                <Button type="button" disabled={Boolean(busyAction)} onClick={moveBack}>
                  戻る
                </Button>
              )}
              <Button type="submit" variant="primary" disabled={Boolean(busyAction)}>
                {currentStep === 4
                  ? busyAction === 'save' ? '確かめて保存しています…' : '接続を確かめて保存'
                  : '次へ'}
              </Button>
            </>
          )}
        />
      </form>
    </div>
  )
}

function getStepErrors(step: StepNumber, form: AccountFormState, timezone: string): FieldErrors {
  const errors: FieldErrors = {}
  if (step === 1) {
    if (!form.name.trim()) errors.name = '表示名を入力してください。'
    if (!timezone) errors.timezone = 'タイムゾーンを選んでください。'
  }
  if (step === 3) {
    if (!form.channelId.trim()) errors.channelId = 'チャネルIDを入力してください。'
    else if (!/^\d+$/.test(form.channelId.trim())) errors.channelId = 'チャネルIDは半角数字で入力してください。'
    if (!form.channelSecret) errors.channelSecret = 'チャネルシークレットを入力してください。'
    if (!form.channelAccessToken) errors.channelAccessToken = 'チャネルアクセストークンを入力してください。'
  }
  if (step === 3) {
    if (!form.loginChannelId.trim()) errors.loginChannelId = 'LoginチャネルIDを入力してください。'
    else if (!/^\d+$/.test(form.loginChannelId.trim())) errors.loginChannelId = 'LoginチャネルIDは半角数字で入力してください。'
    if (!form.loginChannelSecret) errors.loginChannelSecret = 'Loginチャネルシークレットを入力してください。'
    if (!form.liffId.trim()) errors.liffId = 'LIFF IDを入力してください。'
    else if (!/^\d+-[A-Za-z0-9_-]+$/.test(form.liffId.trim())) errors.liffId = 'LIFF IDは「数字-英数字」の形式で入力してください。'
  }
  return errors
}

function SetupSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="bg-canvas rounded-card border-hairline border p-5">
      <h2 className="text-ink text-base font-bold">{title}</h2>
      <p className="text-ink-secondary mt-1 text-xs leading-relaxed">{description}</p>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-canvas rounded-card border-hairline border p-5">
      <h3 className="text-ink text-sm font-bold">{title}</h3>
      <div className="text-ink-secondary mt-3 text-xs leading-relaxed">{children}</div>
    </section>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  required = false,
  type = 'text',
  inputMode,
  error,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
  type?: 'text' | 'password'
  inputMode?: 'text' | 'numeric'
  error?: string
}) {
  const errorId = `${id}-error`
  return (
    <label className="block" htmlFor={id}>
      <span className="text-ink-secondary mb-1 block text-xs font-medium">
        {label}{required && <span className="text-danger ml-1">必須</span>}
      </span>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        inputMode={inputMode}
        autoComplete={type === 'password' ? 'new-password' : undefined}
        spellCheck={type === 'password' ? false : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="border-hairline rounded-control text-ink w-full border px-3 py-2 text-sm"
      />
      {error && <span id={errorId} className="text-danger mt-1 block text-xs">{error}</span>}
    </label>
  )
}

function SelectField({ id, label, value, onChange, options, required = false, error }: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  required?: boolean
  error?: string
}) {
  const errorId = `${id}-error`
  return (
    <label className="block" htmlFor={id}>
      <span className="text-ink-secondary mb-1 block text-xs font-medium">
        {label}{required && <span className="text-danger ml-1">必須</span>}
      </span>
      <Select
        id={id}
        aria-label={label}
        value={value}
        onChange={onChange}
        options={options}
        size="full"
        error={error}
      />
      {error && <span id={errorId} className="text-danger mt-1 block text-xs">{error}</span>}
    </label>
  )
}

function EndpointRow({ label, value, help }: { label: string; value: string; help: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (value === '—' || value.startsWith('LIFF ID')) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // クリップボードを利用できない場合も、表示されたURLを選択してコピーできる。
    }
  }
  const disabled = value === '—' || value.startsWith('LIFF ID')
  return (
    <div>
      <p className="text-ink-faint text-xs font-medium">{label}</p>
      <div className="mt-1 flex items-stretch gap-2">
        <p className="bg-canvas-sunken rounded-control text-ink min-w-0 flex-1 select-all break-all px-3 py-2 text-xs leading-relaxed">{value}</p>
        <Button type="button" onClick={() => void copy()} disabled={disabled} className="shrink-0">
          {copied ? 'コピー済み' : 'コピー'}
        </Button>
      </div>
      <p className="text-ink-faint mt-1 text-xs">{help}</p>
    </div>
  )
}

function ReviewGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-hairline rounded-control border p-4">
      <h3 className="text-ink text-sm font-bold">{title}</h3>
      <dl className="mt-3 divide-y divide-hairline">{children}</dl>
    </section>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-3">
      <dt className="text-ink-faint text-xs">{label}</dt>
      <dd className="text-ink break-all text-sm sm:col-span-2">{value}</dd>
    </div>
  )
}

function SecretReviewRow({ label }: { label: string }) {
  return <ReviewRow label={label} value="入力済み（安全のため表示しません）" />
}
