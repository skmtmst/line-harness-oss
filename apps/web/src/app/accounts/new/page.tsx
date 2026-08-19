'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { LineAccount } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'

type CopyItem = 'accountSettings' | 'scenarios' | 'autoReplies'
type Verification = {
  messagingApi: boolean
  webhook: boolean
  lineLogin: boolean
  liff: boolean
  webhookUrl: string | null
  errors: string[]
}

const STEPS = [
  ['所属店舗・アカウント情報', '管理画面で使う名前を設定'],
  ['Messaging API', 'Bot認証を確認済み'],
  ['Webhook', '実際の受信を確認済み'],
  ['LINE Login', 'ログイン接続を設定中'],
  ['LIFF・最終接続', '前の完了後に入力できます'],
] as const

const COPY_ITEMS: Array<{ key: CopyItem; label: string; note: string }> = [
  { key: 'accountSettings', label: 'アカウント設定', note: '配信や予約などの運用設定' },
  { key: 'scenarios', label: 'シナリオ', note: 'ステップ・分岐・完了時アクション' },
  { key: 'autoReplies', label: '自動応答', note: 'キーワード・応答内容・条件' },
]

const INPUT = 'h-11 w-full rounded-control border border-hairline bg-canvas px-3 text-sm text-ink outline-none focus:border-accent disabled:bg-canvas-sunken'

function workerBase() {
  return (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
}

export default function NewLineAccountPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [channelId, setChannelId] = useState('')
  const [channelAccessToken, setChannelAccessToken] = useState('')
  const [channelSecret, setChannelSecret] = useState('')
  const [webhookConfigured, setWebhookConfigured] = useState(false)
  const [loginChannelId, setLoginChannelId] = useState('')
  const [loginChannelSecret, setLoginChannelSecret] = useState('')
  const [liffId, setLiffId] = useState('')
  const [liffConfigured, setLiffConfigured] = useState(false)
  const [copyMode, setCopyMode] = useState(false)
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [copyFromAccountId, setCopyFromAccountId] = useState('')
  const [copyItems, setCopyItems] = useState<CopyItem[]>([])
  const [verification, setVerification] = useState<Verification | null>(null)
  const [currentStep, setCurrentStep] = useState(1)
  const [error, setError] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void api.lineAccounts.list().then((response) => {
      if (response.success) setAccounts(response.data)
    })
  }, [])

  const connectedSources = useMemo(
    () => accounts.filter((account) => account.isActive && account.loginChannelId && account.liffId),
    [accounts],
  )
  const messagingReady = Boolean(name.trim() && channelId.trim() && channelAccessToken.trim() && channelSecret.trim())
  const loginReady = Boolean(loginChannelId.trim() && loginChannelSecret.trim())
  const liffReady = Boolean(liffId.trim() && liffConfigured)
  const allVerified = Boolean(verification?.messagingApi && verification.webhook && verification.lineLogin && verification.liff)
  const completedCount = allVerified ? 5 : currentStep - 1
  const base = workerBase()
  const webhookUrl = base ? `${base}/webhook` : ''
  const callbackUrl = base ? `${base}/auth/callback` : ''
  const liffEndpointUrl = base && liffId.trim() ? `${base}?liffId=${encodeURIComponent(liffId.trim())}` : ''

  const connectionFingerprint = [channelAccessToken, loginChannelId, loginChannelSecret, liffId].join('\n')
  useEffect(() => { setVerification(null) }, [connectionFingerprint])

  const next = (step: number) => {
    setError('')
    if (step === 1) {
      if (!name.trim()) return setError('管理画面での表示名を入力してください')
      if (copyMode && (!copyFromAccountId || copyItems.length === 0)) return setError('コピー元とコピー項目を選んでください')
    }
    if (step === 2 && !messagingReady) return setError('Messaging APIの4項目を入力してください')
    if (step === 3 && !webhookConfigured) return setError('Webhook URLを設定し、利用をONにしたことを確認してください')
    if (step === 4 && !loginReady) return setError('LINE LoginのChannel IDとChannel Secretを入力してください')
    setCurrentStep(Math.min(5, step + 1))
  }

  const verify = async () => {
    if (!liffReady) return setError('LIFF IDとEndpoint URLの設定を完了してください')
    setVerifying(true)
    setError('')
    const response = await api.lineAccounts.verifyConnection({
      channelAccessToken: channelAccessToken.trim(),
      loginChannelId: loginChannelId.trim(),
      loginChannelSecret: loginChannelSecret.trim(),
      liffId: liffId.trim(),
    })
    setVerification(response.success ? response.data : {
      messagingApi: false, webhook: false, lineLogin: false, liff: false,
      webhookUrl: null, errors: [response.error],
    })
    setVerifying(false)
  }

  const save = async () => {
    if (!allVerified || saving) return
    setSaving(true)
    setError('')
    try {
      const response = await api.lineAccounts.create({
        name: name.trim(), channelId: channelId.trim(),
        channelAccessToken: channelAccessToken.trim(), channelSecret: channelSecret.trim(),
        loginChannelId: loginChannelId.trim(), loginChannelSecret: loginChannelSecret.trim(), liffId: liffId.trim(),
        copyFromAccountId: copyMode ? copyFromAccountId : null,
        copyItems: copyMode ? copyItems : [],
      })
      if (!response.success) throw new Error(response.error)
      router.push(`/accounts?highlight=${response.data.id}`)
    } catch (cause) {
      setError(cause instanceof ApiError || cause instanceof Error ? cause.message : '追加に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return <div>
    <nav className="mb-4 text-xs text-ink-faint"><Link href="/accounts" className="font-medium text-accent hover:underline">アカウント</Link><span className="mx-2">/</span><span>新規追加</span></nav>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-bold tracking-tight text-ink">LINEアカウントを追加する</h1><p className="mt-1 text-sm text-ink-secondary">案内に沿って設定します。すべての接続確認が完了するまでアカウントは追加されません。</p></div>
      <div className="flex items-center gap-2">
        <button onClick={() => { setCopyMode(true); setCurrentStep(1) }} className="cursor-pointer whitespace-nowrap rounded-control border border-hairline bg-canvas px-4 py-2 text-sm font-medium text-accent hover:bg-info-bg">⊞ 既存設定から追加</button>
        <Link href="/accounts" className="whitespace-nowrap rounded-control border border-hairline bg-canvas px-4 py-2 text-sm font-medium text-ink">キャンセル</Link>
        <button onClick={() => void save()} disabled={!allVerified || saving} className="cursor-pointer whitespace-nowrap rounded-control bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:cursor-not-allowed disabled:bg-hairline">🔒 {saving ? '追加中…' : 'アカウントを追加'}</button>
      </div>
    </div>
    <div className="mb-4 rounded-control border border-info bg-info-bg px-4 py-3 text-sm font-medium text-accent">♢ 安全のため、Messaging API・Webhook・LINE Login・LIFFの実接続を順番に確認します。</div>

    <div className="grid items-start gap-4 xl:grid-cols-[265px_minmax(0,1fr)_290px]">
      <aside className="space-y-4">
        <section className="rounded-card border border-hairline bg-canvas p-4">
          <div className="flex items-center justify-between"><h2 className="font-semibold text-ink">設定の進み具合</h2><span className="rounded-pill bg-info-bg px-2 py-1 text-xs font-semibold text-accent">{completedCount} / 5 完了</span></div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-canvas-sunken"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${completedCount * 20}%` }} /></div>
          <div className="mt-4 space-y-2">{STEPS.map(([label, note], index) => {
            const step = index + 1; const complete = step < currentStep || allVerified; const active = step === currentStep && !allVerified; const locked = step > currentStep
            return <button key={label} disabled={locked} onClick={() => { if (!locked) setCurrentStep(step) }} className={`flex w-full items-center gap-3 rounded-control border px-3 py-3 text-left ${active ? 'border-accent bg-accent-soft' : 'border-transparent'} disabled:cursor-not-allowed`}>
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${complete ? 'bg-accent-soft text-success' : active ? 'bg-accent text-on-accent' : 'bg-canvas-sunken text-ink-faint'}`}>{complete ? '✓' : locked ? '🔒' : step}</span>
              <span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink">{label}</span><span className="block truncate text-[11px] text-ink-faint">{note}</span></span>
              {active && <span className="ml-auto whitespace-nowrap rounded-pill bg-accent px-2 py-1 text-[10px] font-semibold text-on-accent">設定中</span>}
            </button>
          })}</div>
          <p className="mt-3 rounded-control bg-canvas-sunken p-3 text-xs leading-5 text-ink-secondary">ⓘ 前のステップが完了すると、次の入力欄が開きます。</p>
        </section>
        <section className="rounded-card border border-warning bg-warning-bg p-4"><h2 className="text-sm font-semibold text-warning">◇ 途中では追加されません</h2><p className="mt-2 text-xs leading-5 text-ink-secondary">入力内容はこの画面内に一時保持されます。最終接続が成功した後だけ追加できます。</p></section>
      </aside>

      <main className="min-w-0 space-y-3">
        <section className="rounded-card border border-hairline bg-canvas p-5">
          <StepHeader step={currentStep} title={STEPS[currentStep - 1][0]} note={stepNote(currentStep)} />
          {error && <p className="mt-4 rounded-control border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p>}
          <div className="mt-5">{currentStep === 1 && <StepAccount copyMode={copyMode} setCopyMode={setCopyMode} name={name} setName={setName} sources={connectedSources} copyFrom={copyFromAccountId} setCopyFrom={setCopyFromAccountId} copyItems={copyItems} toggleCopy={(key) => setCopyItems((items) => items.includes(key) ? items.filter((item) => item !== key) : [...items, key])} />}
            {currentStep === 2 && <StepMessaging channelId={channelId} setChannelId={setChannelId} token={channelAccessToken} setToken={setChannelAccessToken} secret={channelSecret} setSecret={setChannelSecret} />}
            {currentStep === 3 && <StepWebhook url={webhookUrl} checked={webhookConfigured} setChecked={setWebhookConfigured} />}
            {currentStep === 4 && <StepLogin name={name} id={loginChannelId} setId={setLoginChannelId} secret={loginChannelSecret} setSecret={setLoginChannelSecret} callbackUrl={callbackUrl} />}
            {currentStep === 5 && <StepLiff id={liffId} setId={(value) => { setLiffId(value); setLiffConfigured(false) }} endpoint={liffEndpointUrl} checked={liffConfigured} setChecked={setLiffConfigured} verification={verification} verifying={verifying} verify={verify} />}
          </div>
          <div className="mt-5 flex items-center justify-between gap-3"><button disabled={currentStep === 1} onClick={() => { setError(''); setCurrentStep((step) => Math.max(1, step - 1)) }} className="cursor-pointer rounded-control border border-hairline px-4 py-2 text-sm font-medium text-ink disabled:opacity-0">前のステップへ</button>{currentStep < 5 && <button onClick={() => next(currentStep)} className="cursor-pointer rounded-control bg-accent px-5 py-2.5 text-sm font-semibold text-on-accent">{STEPS[currentStep - 1][0]}を確認して次へ →</button>}</div>
        </section>
        {currentStep < 5 && <section className="rounded-card border border-hairline bg-canvas p-4 opacity-60"><div className="flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-canvas-sunken text-xs">🔒</span><div><h3 className="text-sm font-semibold text-ink">ステップ{currentStep + 1}　{STEPS[currentStep][0]}</h3><p className="text-xs text-ink-faint">前の完了後に入力できます。</p></div><span className="ml-auto rounded-pill bg-canvas-sunken px-2 py-1 text-xs text-ink-faint">🔒 ロック中</span></div></section>}
      </main>

      <aside className="space-y-4">
        <Conditions step={currentStep} />
        <section className="rounded-card border border-hairline bg-canvas p-4"><div className="flex items-center justify-between"><h2 className="font-semibold text-ink">アカウント追加まで</h2><span className="text-xs font-semibold text-accent">{completedCount} / 5完了</span></div><div className="mt-4 space-y-3">{STEPS.map(([label], index) => <div key={label} className="flex items-center gap-2 text-xs"><span className={index < completedCount ? 'text-success' : index === completedCount ? 'text-warning' : 'text-ink-faint'}>{index < completedCount ? '◉' : index === completedCount ? '◌' : '🔒'}</span><span className="text-ink">{label}</span><span className={`ml-auto ${index < completedCount ? 'text-success' : index === completedCount ? 'text-warning' : 'text-ink-faint'}`}>{index < completedCount ? '完了' : index === completedCount ? '確認待ち' : 'ロック'}</span></div>)}</div><button onClick={() => void save()} disabled={!allVerified || saving} className="mt-4 w-full cursor-pointer rounded-control bg-accent px-3 py-2.5 text-sm font-semibold text-on-accent disabled:cursor-not-allowed disabled:bg-hairline">🔒 すべて確認後に追加できます</button></section>
        <section className="rounded-card border border-info bg-info-bg p-4"><h2 className="text-sm font-semibold text-accent">ⓘ 設定に迷ったとき</h2><p className="mt-2 text-xs leading-5 text-ink-secondary">各ボタンから設定場所や公式手順を別タブで開けます。入力内容は自動で公開されません。</p><div className="mt-3 grid gap-2"><HelpLink href="https://developers.line.biz/ja/docs/line-login/overview/" label="LINE Login公式ガイド" /><HelpLink href="https://developers.line.biz/ja/docs/liff/overview/" label="LIFF設定を先に確認" /></div></section>
      </aside>
    </div>
  </div>
}

function stepNote(step: number) {
  return ['追加方法と管理画面で使う名前を決めます。','Messaging APIのChannel情報を入力します。','LINE Developers側へWebhook URLを登録します。','ログインと友だち追加導線が正しく動くことを確認します。','LIFFの設定とすべての実接続をまとめて確認します。'][step - 1]
}

function StepHeader({ step, title, note }: { step: number; title: string; note: string }) { return <div className="flex items-start gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-on-accent">{step}</span><div><h2 className="text-xl font-bold text-ink">{title}を設定する</h2><p className="mt-1 text-xs text-ink-faint">{note}</p></div><span className="ml-auto whitespace-nowrap rounded-pill bg-accent-soft px-3 py-1 text-xs font-semibold text-success">入力できます</span></div> }
function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) { return <label className="block"><span className="text-xs font-semibold text-ink">{label}{required && <span className="ml-2 rounded-pill bg-danger-bg px-2 py-0.5 text-[10px] text-danger">必須</span>}</span><div className="mt-2">{children}</div></label> }
function StepAccount({ copyMode, setCopyMode, name, setName, sources, copyFrom, setCopyFrom, copyItems, toggleCopy }: { copyMode: boolean; setCopyMode: (value: boolean) => void; name: string; setName: (value: string) => void; sources: LineAccount[]; copyFrom: string; setCopyFrom: (value: string) => void; copyItems: CopyItem[]; toggleCopy: (key: CopyItem) => void }) { return <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><button onClick={() => setCopyMode(false)} className={`rounded-control border p-4 text-left ${!copyMode ? 'border-accent bg-accent-soft' : 'border-hairline'}`}><b className="text-sm">新しく設定して追加</b><span className="mt-1 block text-xs text-ink-faint">空のアカウントとして追加</span></button><button onClick={() => setCopyMode(true)} className={`rounded-control border p-4 text-left ${copyMode ? 'border-accent bg-accent-soft' : 'border-hairline'}`}><b className="text-sm">既存設定から追加</b><span className="mt-1 block text-xs text-ink-faint">権限上見える接続済みアカウントからコピー</span></button></div><Field label="管理画面での表示名" required><input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：A店 公式LINE" className={INPUT} /></Field>{copyMode && <div className="rounded-control border border-hairline p-4"><p className="text-sm font-semibold">コピー元</p><div className="mt-2 grid gap-2">{sources.length === 0 ? <p className="text-xs text-ink-faint">選択できる接続済みアカウントはありません。</p> : sources.map((account) => <label key={account.id} className={`flex cursor-pointer items-center gap-2 rounded-control border px-3 py-2 text-sm ${copyFrom === account.id ? 'border-accent bg-accent-soft' : 'border-hairline'}`}><input type="radio" checked={copyFrom === account.id} onChange={() => setCopyFrom(account.id)} />{account.name}<span className="ml-auto text-xs text-success">接続済み</span></label>)}</div><p className="mt-4 text-sm font-semibold">コピー項目</p><div className="mt-2 grid gap-2 sm:grid-cols-3">{COPY_ITEMS.map((item) => <label key={item.key} className={`cursor-pointer rounded-control border p-3 ${copyItems.includes(item.key) ? 'border-accent bg-accent-soft' : 'border-hairline'}`}><span className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={copyItems.includes(item.key)} onChange={() => toggleCopy(item.key)} />{item.label}</span><span className="mt-1 block text-[10px] text-ink-faint">{item.note}</span></label>)}</div></div>}</div> }
function StepMessaging({ channelId, setChannelId, token, setToken, secret, setSecret }: { channelId: string; setChannelId: (v: string) => void; token: string; setToken: (v: string) => void; secret: string; setSecret: (v: string) => void }) { return <div className="space-y-4"><div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold">まずLINE Developers Consoleを開きます</h3><p className="text-xs text-ink-faint">Messaging APIチャネルの基本設定を開いてください。</p></div><ConsoleLink label="LINE Developersを開く" /></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Messaging API Channel ID" required><input value={channelId} onChange={(e) => setChannelId(e.target.value)} className={INPUT} /></Field><Field label="Messaging API Channel Secret" required><input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} className={INPUT} /></Field></div><Field label="Channel Access Token（長期）" required><input type="password" value={token} onChange={(e) => setToken(e.target.value)} className={INPUT} /></Field><InfoActions label="ID・Secret・Tokenはどこにありますか？" /></div> }
function StepWebhook({ url, checked, setChecked }: { url: string; checked: boolean; setChecked: (v: boolean) => void }) { return <div className="space-y-4"><div className="rounded-control border border-warning bg-warning-bg px-4 py-3 text-xs text-ink-secondary">⚠ Messaging API設定のWebhook URLに以下を貼り付け、「Webhookの利用」をONにしてください。</div><UrlRow label="Webhook URL" hint="LINE Developers → Messaging API設定" url={url} /><label className="flex cursor-pointer items-center gap-3 rounded-control border border-hairline p-4 text-sm"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />Webhook URLを設定し、利用をONにしました</label><div className="flex justify-end"><ConsoleLink label="Webhook設定を開く" /></div></div> }
function StepLogin({ name, id, setId, secret, setSecret, callbackUrl }: { name: string; id: string; setId: (v: string) => void; secret: string; setSecret: (v: string) => void; callbackUrl: string }) { return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2 border-y border-hairline py-3 text-xs"><b>⚒ 設定対象：{name.trim() || '新しいLINE公式アカウント'}</b><span className="font-semibold text-success">Messaging API / Webhook 確認済み</span></div><div className="rounded-control border border-warning bg-warning-bg px-4 py-3 text-xs text-ink-secondary">⚠ Messaging APIチャネルと同じProvider内にLINE Loginチャネルを作り、対象のLINE公式アカウントをリンクしてください。</div><div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold">まずLINE Developers Consoleを開きます</h3><p className="text-xs text-ink-faint">対象Provider → LINE Loginチャネルを選択</p></div><ConsoleLink label="LINE Developersを開く" /></div><div className="grid gap-4 sm:grid-cols-2"><Field label="LINE Login Channel ID" required><input value={id} onChange={(e) => setId(e.target.value)} placeholder="例：1650000000" className={INPUT} /></Field><Field label="LINE Login Channel Secret" required><input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} className={INPUT} /></Field></div><InfoActions label="ID・Secretはどこにありますか？" /><UrlRow label="Callback URL" hint="LINE Login設定 → Callback URL" url={callbackUrl} /><div className="flex items-center justify-between rounded-control border border-hairline px-4 py-3"><div><p className="text-xs font-semibold">LINE公式アカウントをリンクする</p><p className="text-[11px] text-ink-faint">友だち追加オプションを使うために必要です。</p></div><ConsoleLink label="リンク設定を開く" secondary /></div></div> }
function StepLiff({ id, setId, endpoint, checked, setChecked, verification, verifying, verify }: { id: string; setId: (v: string) => void; endpoint: string; checked: boolean; setChecked: (v: boolean) => void; verification: Verification | null; verifying: boolean; verify: () => Promise<void> }) { return <div className="space-y-4"><Field label="LIFF ID" required><input value={id} onChange={(e) => setId(e.target.value)} placeholder="1234567890-AbCdEfGh" className={INPUT} /></Field><UrlRow label="LIFF Endpoint URL" hint="LINE Loginチャネル → LIFF" url={endpoint} /><label className="flex cursor-pointer items-center gap-3 rounded-control border border-hairline p-4 text-sm"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />LIFF IDとEndpoint URLを設定しました</label><div className="grid gap-2 sm:grid-cols-4">{([['messagingApi','Messaging API'],['webhook','Webhook'],['lineLogin','LINE Login'],['liff','LIFF']] as const).map(([key,label]) => <div key={key} className={`rounded-control border px-3 py-3 text-center text-xs ${verification?.[key] ? 'border-accent bg-accent-soft text-success' : 'border-hairline text-ink-faint'}`}>{verification?.[key] ? '✓' : '○'} {label}</div>)}</div>{verification?.errors?.length ? <ul className="rounded-control bg-danger-bg p-3 text-xs text-danger">{verification.errors.map((value) => <li key={value}>・{value}</li>)}</ul> : null}<button onClick={() => void verify()} disabled={verifying} className="w-full cursor-pointer rounded-control bg-accent px-4 py-3 text-sm font-semibold text-on-accent disabled:opacity-50">{verifying ? '接続確認中…' : 'LIFF・Webhook・LINE Loginの実接続を確認'}</button></div> }
function ConsoleLink({ label, secondary = false }: { label: string; secondary?: boolean }) { return <a href="https://developers.line.biz/console/" target="_blank" rel="noreferrer" className={`inline-flex whitespace-nowrap rounded-control px-3 py-2 text-xs font-semibold ${secondary ? 'border border-info bg-canvas text-accent' : 'bg-accent text-on-accent'}`}>{label} ↗</a> }
function HelpLink({ href, label }: { href: string; label: string }) { return <a href={href} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-control bg-canvas px-3 py-2 text-xs font-medium text-accent">{label}<span>↗</span></a> }
function InfoActions({ label }: { label: string }) { return <div className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-info-bg p-3"><div><p className="text-xs font-semibold text-accent">{label}</p><p className="mt-1 text-[11px] text-ink-secondary">LINE Developers → 対象Provider → チャネル基本設定</p></div><div className="flex gap-2"><ConsoleLink label="対象画面を開く" secondary /><HelpLink href="https://developers.line.biz/ja/docs/" label="公式手順を見る" /></div></div> }
function UrlRow({ label, hint, url }: { label: string; hint: string; url: string }) { const [copied,setCopied] = useState(false); const copy = async () => { if (!url) return; await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1200) }; return <div><div className="mb-2 flex justify-between gap-3"><span className="text-xs font-semibold text-ink">{label}</span><span className="truncate text-[10px] text-ink-faint">{hint}</span></div><div className="flex gap-2"><input readOnly value={url} className={`${INPUT} min-w-0 flex-1 font-mono text-xs`} /><button onClick={() => void copy()} disabled={!url} className="cursor-pointer whitespace-nowrap rounded-control border border-hairline px-3 text-xs font-semibold text-accent disabled:opacity-40">{copied ? '✓ コピー済み' : '⧉ コピー'}</button></div></div> }
function Conditions({ step }: { step: number }) { const items = step === 4 ? ['Channel ID・Secretが有効','Callback URLが一致','ログイン認証が最後まで完了','公式アカウントのリンクを確認'] : step === 5 ? ['LIFF IDを入力','Endpoint URLを登録','LIFF起動を実機確認','4つの接続判定がすべて正常'] : ['必須項目の入力','LINE Developers側の設定','このステップの確認ボタン']; return <section className="rounded-card border border-hairline bg-canvas p-4"><h2 className="font-semibold text-ink">このステップの完了条件</h2><p className="mt-2 text-xs text-ink-faint">ボタンを押すと、以下をまとめて確認します。</p><ul className="mt-4 space-y-3">{items.map((item) => <li key={item} className="flex gap-2 text-xs text-ink-secondary"><span className="text-warning">◌</span>{item}</li>)}</ul></section> }
