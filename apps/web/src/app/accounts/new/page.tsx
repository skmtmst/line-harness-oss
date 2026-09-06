'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '@/lib/api'
import type { LineAccount } from '@line-crm/shared'
import Button from '@/components/shared/button'
import PageHeader from '@/components/shared/page-header'
import StickyBar from '@/components/shared/sticky-bar'
import StatusBadge from '@/components/shared/status-badge'
import { emptyAccountFormState, type AccountFormState } from '@/components/accounts/account-form-fields'
import {
  CHECK_STATE_LABEL,
  canSave,
  capacityError,
  stoppedAt,
  toSteps,
  type VerifyResult,
} from '../connection-check-view'

/**
 * LINEアカウントを登録する。設計 ★V6 33-2（`b2NGxk`）。
 *
 * **これまでここは店舗ウィザードへの転送だった。** 店舗を作ることと、
 * LINE公式アカウントを登録することは別（要件 §5-3）。
 *
 * **確かめてから保存する。** 通らないまま保存すると、「登録できたのに
 * 届かない」という一番わかりにくい壊れ方になる。
 */
export default function NewLineAccountPage() {
  const router = useRouter()
  const [form, setForm] = useState<AccountFormState>(emptyAccountFormState)
  const [capacity, setCapacity] = useState('')
  const [warnAt, setWarnAt] = useState('')
  const [timezone, setTimezone] = useState('Asia/Tokyo')
  const [country, setCountry] = useState('日本')
  const [role, setRole] = useState('')
  const [parentLineAccountId, setParentLineAccountId] = useState('')
  const [parentAccounts, setParentAccounts] = useState<LineAccount[]>([])
  const [verify, setVerify] = useState<VerifyResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const steps = useMemo(() => toSteps(verify), [verify])
  const stopped = stoppedAt(steps)
  const capacityMessage = capacityError(capacity, warnAt)
  const workerBase = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
  const webhookUrl = workerBase ? `${workerBase}/webhook` : '—'
  const callbackUrl = workerBase ? `${workerBase}/auth/callback` : '—'
  const liffEndpointUrl = workerBase && form.liffId
    ? `${workerBase}?liffId=${encodeURIComponent(form.liffId)}`
    : 'LIFF IDを入力すると表示します'

  const update = (partial: Partial<AccountFormState>) => setForm((f) => ({ ...f, ...partial }))

  useEffect(() => {
    let active = true
    void api.lineAccounts.list().then((response) => {
      if (active && response.success) {
        setParentAccounts(response.data.filter((account) => !account.archivedAt))
      }
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  /**
   * 確かめてから保存する。**どこかで止まったら保存しない。**
   * 確かめるだけでは記録を残さない（設計の一言どおり）。
   */
  const verifyAndSave = async () => {
    if (capacityMessage) return
    setBusy(true)
    setError('')
    try {
      const checked = await api.lineAccounts.verifyConnection({
        channelAccessToken: form.channelAccessToken,
        loginChannelId: form.loginChannelId,
        loginChannelSecret: form.loginChannelSecret,
        liffId: form.liffId,
      })
      if (!checked.success) { setError(checked.error); return }
      setVerify(checked.data)
      if (!canSave(toSteps(checked.data))) return

      const created = await api.lineAccounts.create({
        channelId: form.channelId,
        name: form.name,
        channelAccessToken: form.channelAccessToken,
        channelSecret: form.channelSecret,
        loginChannelId: form.loginChannelId || null,
        loginChannelSecret: form.loginChannelSecret || null,
        liffId: form.liffId || null,
        timezone,
        country: country || null,
        role: role || null,
        parentLineAccountId: parentLineAccountId || null,
      })
      if (!created.success) { setError(created.error); return }
      router.push(`/accounts/${created.data.id}`)
    } catch {
      setError('登録できませんでした。しばらくおいてから、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-design-node="b2NGxk" className="pb-24">
      <PageHeader
        breadcrumb={[{ label: 'LINEアカウント', href: '/accounts' }, { label: '登録' }]}
        title="LINEアカウントを登録"
        description="送受信に使うLINE公式アカウントを登録します。保存する前に接続を確かめます。"
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <SetupSection
            title="基本情報"
            description="管理画面で見分ける名前を付けます。登録後も変更できます。"
          >
            <Field
              label="表示名"
              value={form.name}
              onChange={(value) => update({ name: value })}
              placeholder="例：然-NEN- 本店"
              required
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                label="タイムゾーン"
                value={timezone}
                onChange={setTimezone}
                options={[
                  { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
                  { value: 'Asia/Ho_Chi_Minh', label: 'Asia/Ho_Chi_Minh' },
                ]}
                required
              />
              <Field label="国・地域（任意）" value={country} onChange={setCountry} placeholder="例：日本" />
            </div>
            <Field
              label="役割メモ（任意）"
              value={role}
              onChange={setRole}
              placeholder="例：検証用。本番の配信には使わない"
            />
            <SelectField
              label="親アカウント（任意）"
              value={parentLineAccountId}
              onChange={setParentLineAccountId}
              options={[
                { value: '', label: '選んでください' },
                ...parentAccounts.map((account) => ({ value: account.id, label: account.name })),
              ]}
            />
          </SetupSection>

          <SetupSection
            title="Messaging API"
            description="LINE公式アカウントからメッセージを送受信するための必須情報です。"
          >
            <Field
              label="チャネルID"
              value={form.channelId}
              onChange={(value) => update({ channelId: value })}
              placeholder="例：123456789"
              required
            />
            <Field
              label="チャネルシークレット"
              value={form.channelSecret}
              onChange={(value) => update({ channelSecret: value })}
              type="password"
              required
            />
            <Field
              label="チャネルアクセストークン"
              value={form.channelAccessToken}
              onChange={(value) => update({ channelAccessToken: value })}
              type="password"
              required
            />
            <p className="bg-warning-bg text-warning rounded-control p-3 text-xs leading-relaxed">
              資格情報は暗号化して保存し、保存後は画面に再表示しません。
            </p>
          </SetupSection>

          <SetupSection
            title="友だち追加・LIFF"
            description="LINE Login や LIFF を使う場合だけ入力します。あとから追加できます。"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="LoginチャネルID"
                value={form.loginChannelId}
                onChange={(value) => update({ loginChannelId: value })}
              />
              <Field
                label="Loginチャネルシークレット"
                value={form.loginChannelSecret}
                onChange={(value) => update({ loginChannelSecret: value })}
                type="password"
              />
            </div>
            <Field
              label="LIFF ID"
              value={form.liffId}
              onChange={(value) => update({ liffId: value })}
              placeholder="例：2009624792-XXXXXXXX"
            />
          </SetupSection>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-bold">保存する前の接続確認</p>
            <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
              「接続を確かめて保存」を押すと、次の順で確かめます。どこかで止まったら保存しません。
              確かめるだけで、記録は残りません。
            </p>
            <ol className="mt-3 space-y-2">
              {steps.map((step) => (
                <li key={step.order} className="border-hairline rounded-control flex items-start gap-3 border p-3">
                  <span className="text-ink-faint w-4 shrink-0 text-xs tabular-nums">{step.order}</span>
                  <span className="text-ink min-w-0 flex-1 text-xs leading-relaxed">{step.label}</span>
                  {/* **色だけに頼らず、必ず文字で状態を言う。** */}
                  <StatusBadge
                    tone={step.state === 'passed' ? 'success' : step.state === 'failed' ? 'warning' : 'neutral'}
                  >
                    {CHECK_STATE_LABEL[step.state]}
                  </StatusBadge>
                </li>
              ))}
            </ol>
            {stopped && (
              <p role="alert" className="bg-warning-bg text-warning rounded-control mt-3 p-3 text-xs leading-relaxed">
                {stopped.order} で止まりました。右の「Webhookのつなぎ先」にあるURLを LINE Developers
                のチャネル設定に貼り、「Webhookの利用」をオンにしてください。
                4 は 3 が通るまで確かめられません。
              </p>
            )}
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-bold">友だち数の見張り（任意）</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-ink-secondary mb-1 block text-xs font-medium">友だち数の上限</span>
                <input
                  type="number" inputMode="numeric" value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder="例：50000"
                  className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-ink-secondary mb-1 block text-xs font-medium">警告を出す友だち数</span>
                <input
                  type="number" inputMode="numeric" value={warnAt}
                  onChange={(e) => setWarnAt(e.target.value)}
                  placeholder="例：45000"
                  aria-invalid={capacityMessage ? true : undefined}
                  className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
                />
              </label>
            </div>
            {capacityMessage && (
              <p role="alert" className="text-danger mt-2 text-xs">{capacityMessage}</p>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-bold">Webhookのつなぎ先</p>
            <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
              下のURLを LINE Developers のチャネル設定に貼り、「Webhookの利用」をオンにしてください。
              URLはアカウントごとに変わりません。
            </p>
            {/*
              **確かめる前はURLを作らない。** 接続確認の返事に入っている
              URLだけを出す。想像で組み立てると、貼り間違いのもとになる。
            */}
            <div className="mt-3 space-y-3">
              <EndpointRow
                label="Webhook URL"
                value={webhookUrl}
                help="LINE Developers → Messaging API"
              />
              <EndpointRow
                label="Callback URL"
                value={callbackUrl}
                help="LINE Login → Callback URL"
              />
              <EndpointRow
                label="LIFF エンドポイント"
                value={liffEndpointUrl}
                help="LIFF → Endpoint URL"
              />
            </div>
            <a className="text-action mt-3 inline-block text-xs font-semibold hover:underline" href="https://developers.line.biz/console/" target="_blank" rel="noreferrer">LINE Developers を開く</a>
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-bold">つながる先</p>
            <ul className="text-ink-secondary mt-3 space-y-2 text-xs leading-relaxed">
              <li>友だち追加URL・QR</li>
              <li>ログインユーザーの担当範囲</li>
              <li>運用状態の接続監視</li>
              <li>友だち一覧</li>
            </ul>
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-bold">気をつけること</p>
            <ul className="text-ink-secondary mt-2 space-y-2 text-xs leading-relaxed">
              <li>・LINE Developers 側で Webhook の利用をオンにしてください。</li>
              <li>・秘密値は保存後に確認できません。安全な場所にも控えてください。</li>
              <li>・接続確認がすべて通るまで登録しません。</li>
            </ul>
          </section>
        </aside>
      </div>

      <StickyBar
        className="mt-4"
        status={verify ? (stopped ? `${stopped.order} で止まっています` : '確かめました') : 'まだ確かめていません'}
        actions={(
          <>
            <Button href="/accounts">やめる</Button>
            <Button
              type="button" variant="primary"
              disabled={busy || Boolean(capacityMessage)}
              onClick={() => void verifyAndSave()}
            >
              {busy ? '確かめています…' : '接続を確かめて保存'}
            </Button>
          </>
        )}
      />

      {error && <p role="alert" className="text-danger mt-3 text-sm">{error}</p>}
    </div>
  )
}

function SetupSection({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="bg-canvas rounded-card border-hairline border p-5">
      <p className="text-ink text-sm font-bold">{title}</p>
      <p className="text-ink-secondary mt-1 text-xs leading-relaxed">{description}</p>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  type = 'text',
  disabled = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
  type?: 'text' | 'password'
  disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="text-ink-secondary mb-1 block text-xs font-medium">
        {label}{required && <span className="text-danger ml-1">必須</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className="border-hairline rounded-control text-ink w-full border px-3 py-2 text-sm disabled:bg-canvas-sunken disabled:text-ink-faint"
      />
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
      // 安全でない接続ではクリップボードが使えないため、表示値を選んでコピーできる形を残す。
    }
  }
  return (
    <div>
      <p className="text-ink-faint text-xs font-medium">{label}</p>
      <div className="mt-1 flex items-stretch gap-2">
        <p className="bg-canvas-sunken rounded-control text-ink min-w-0 flex-1 break-all px-3 py-2 text-xs leading-relaxed">{value}</p>
        <button type="button" onClick={() => void copy()} disabled={value === '—' || value.startsWith('LIFF ID')} className="border-hairline rounded-control border px-3 text-xs font-semibold disabled:opacity-40">{copied ? 'コピー済み' : 'コピー'}</button>
      </div>
      <p className="text-ink-faint mt-1 text-xs">{help}</p>
    </div>
  )
}

function SelectField({ label, value, onChange, options, required = false }: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="text-ink-secondary mb-1 block text-xs font-medium">{label}{required && <span className="text-danger ml-1">必須</span>}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} required={required} className="border-hairline rounded-control text-ink w-full border bg-canvas px-3 py-2 text-sm">
        {options.map((option) => <option key={option.value || 'none'} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}
