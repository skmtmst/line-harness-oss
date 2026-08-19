'use client'

import { useEffect, useMemo, useState } from 'react'
import type { LineAccount } from '@line-crm/shared'
import { api } from '@/lib/api'
import AccountSetupUrls from '@/components/accounts/account-setup-urls'
import CreatePage, { Field, FormSection, inputClass } from '@/components/shared/create-page'

type CopyItem = 'accountSettings' | 'scenarios' | 'autoReplies'
type Verification = {
  messagingApi: boolean
  webhook: boolean
  lineLogin: boolean
  liff: boolean
  webhookUrl: string | null
  errors: string[]
}

const COPY_ITEMS: Array<{ key: CopyItem; label: string; note: string }> = [
  { key: 'accountSettings', label: 'アカウント設定', note: '配信や予約などの運用設定' },
  { key: 'scenarios', label: 'シナリオ', note: 'ステップ・分岐・完了時アクションを含む' },
  { key: 'autoReplies', label: '自動応答', note: 'キーワード・応答内容・条件' },
]

export default function NewLineAccountPage() {
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
  const [verifying, setVerifying] = useState(false)

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
  const loginReady = webhookConfigured && Boolean(loginChannelId.trim() && loginChannelSecret.trim())
  const liffReady = loginReady && Boolean(liffId.trim()) && liffConfigured
  const allVerified = Boolean(
    verification?.messagingApi && verification.webhook && verification.lineLogin && verification.liff,
  )

  const connectionFingerprint = [channelAccessToken, loginChannelId, loginChannelSecret, liffId].join('\n')
  useEffect(() => { setVerification(null) }, [connectionFingerprint])

  const toggleCopyItem = (key: CopyItem) => {
    setCopyItems((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])
  }

  const verify = async () => {
    setVerifying(true)
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

  return (
    <CreatePage
      title="LINEアカウントを追加する"
      description="各設定を順番に完了し、Messaging API・Webhook・LINE Login・LIFFを確認してから追加します。"
      parent={['LINEアカウント', '/accounts']}
      saveLabel="接続済みアカウントを追加"
      validate={() => {
        if (copyMode && !copyFromAccountId) return 'コピー元のアカウントを選択してください'
        if (copyMode && copyItems.length === 0) return 'コピーする項目を1つ以上選択してください'
        if (!messagingReady) return 'アカウント情報とMessaging API設定を完了してください'
        if (!webhookConfigured) return 'WebhookをLINE Developersに設定してください'
        if (!loginReady) return 'LINE Login設定を完了してください'
        if (!liffReady) return 'LIFF設定を完了してください'
        if (!allVerified) return 'すべての接続確認を完了してください'
        return null
      }}
      onSave={async () => {
        const response = await api.lineAccounts.create({
          name: name.trim(), channelId: channelId.trim(),
          channelAccessToken: channelAccessToken.trim(), channelSecret: channelSecret.trim(),
          loginChannelId: loginChannelId.trim(), loginChannelSecret: loginChannelSecret.trim(),
          liffId: liffId.trim(),
          copyFromAccountId: copyMode ? copyFromAccountId : null,
          copyItems: copyMode ? copyItems : [],
        })
        if (!response.success) throw new Error(response.error)
        return response.data.id
      }}
    >
      <FormSection step={1} label="追加方法を選ぶ">
        <div className="grid gap-3 md:grid-cols-2">
          <button type="button" onClick={() => { setCopyMode(false); setCopyFromAccountId(''); setCopyItems([]) }} className={`rounded-card border p-4 text-left ${!copyMode ? 'border-accent bg-accent-bg' : 'border-hairline'}`}>
            <span className="text-sm font-semibold text-ink">新しく設定して追加</span>
            <span className="mt-1 block text-xs text-ink-faint">設定をコピーせず、空のアカウントとして追加します。</span>
          </button>
          <button type="button" onClick={() => setCopyMode(true)} className={`rounded-card border p-4 text-left ${copyMode ? 'border-accent bg-accent-bg' : 'border-hairline'}`}>
            <span className="text-sm font-semibold text-ink">既存設定から追加</span>
            <span className="mt-1 block text-xs text-ink-faint">権限上見える接続済みアカウントから設定を選んでコピーします。</span>
          </button>
        </div>

        {copyMode && <div className="mt-4 space-y-4 rounded-card border border-hairline p-4">
          <div>
            <p className="text-sm font-semibold text-ink">コピー元</p>
            <div className="mt-2 divide-y divide-hairline overflow-hidden rounded-control border border-hairline">
              {connectedSources.length === 0 ? <p className="p-4 text-sm text-ink-faint">選択できる接続済みアカウントはありません。</p> : connectedSources.map((account) => (
                <label key={account.id} className={`flex cursor-pointer items-center gap-3 px-4 py-3 ${copyFromAccountId === account.id ? 'bg-accent-bg text-accent' : 'bg-canvas text-ink'}`}>
                  <input type="radio" name="copy-source" checked={copyFromAccountId === account.id} onChange={() => setCopyFromAccountId(account.id)} className="accent-green-500" />
                  <span className="text-sm font-medium">{account.name}</span>
                  <span className="ml-auto text-xs text-accent">接続済み</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">コピー項目</p>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              {COPY_ITEMS.map((item) => <label key={item.key} className={`cursor-pointer rounded-control border p-3 ${copyItems.includes(item.key) ? 'border-accent bg-accent-bg' : 'border-hairline'}`}><span className="flex items-center gap-2 text-sm font-medium text-ink"><input type="checkbox" checked={copyItems.includes(item.key)} onChange={() => toggleCopyItem(item.key)} className="accent-green-500" />{item.label}</span><span className="mt-1 block pl-6 text-xs text-ink-faint">{item.note}</span></label>)}
            </div>
            <p className="mt-2 text-xs text-ink-faint">認証情報、Webhook、LINE Login、LIFF、友だち、履歴、配信実績はコピーしません。</p>
          </div>
        </div>}
      </FormSection>

      <FormSection step={2} label="アカウント情報とMessaging API">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="管理画面での表示名" htmlFor="account-name" required><input id="account-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例：A店 公式LINE" className={inputClass} /></Field>
          <Field label="Messaging API Channel ID" htmlFor="channel-id" required><input id="channel-id" value={channelId} onChange={(event) => setChannelId(event.target.value)} className={`${inputClass} font-mono`} /></Field>
          <Field label="Channel Access Token（長期）" htmlFor="channel-token" required><input id="channel-token" type="password" value={channelAccessToken} onChange={(event) => setChannelAccessToken(event.target.value)} className={`${inputClass} font-mono`} /></Field>
          <Field label="Messaging API Channel Secret" htmlFor="channel-secret" required><input id="channel-secret" type="password" value={channelSecret} onChange={(event) => setChannelSecret(event.target.value)} className={`${inputClass} font-mono`} /></Field>
        </div>
        <a href="https://developers.line.biz/console/" target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-control border border-hairline px-3 py-2 text-xs font-medium text-accent hover:bg-accent-bg">LINE Developersのチャネル設定を開く ↗</a>
      </FormSection>

      <fieldset disabled={!messagingReady} className="disabled:opacity-45">
        <FormSection step={3} label="Webhookを設定" note="下のWebhook URLをMessaging API設定へ貼り付け、「Webhookの利用」をONにします。">
          <AccountSetupUrls liffId={liffId.trim() || null} />
          <label className="mt-4 flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={webhookConfigured} onChange={(event) => setWebhookConfigured(event.target.checked)} className="accent-green-500" />Webhook URLを設定し、利用をONにしました</label>
        </FormSection>
      </fieldset>

      <fieldset disabled={!webhookConfigured} className="disabled:opacity-45">
        <FormSection step={4} label="LINE Loginを設定" note="LINE Loginチャネルの基本設定にあるIDとSecretを入力し、Callback URLを登録します。">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="LINE Login Channel ID" htmlFor="login-id" required><input id="login-id" value={loginChannelId} onChange={(event) => setLoginChannelId(event.target.value)} className={`${inputClass} font-mono`} /></Field>
            <Field label="LINE Login Channel Secret" htmlFor="login-secret" required><input id="login-secret" type="password" value={loginChannelSecret} onChange={(event) => setLoginChannelSecret(event.target.value)} className={`${inputClass} font-mono`} /></Field>
          </div>
          <a href="https://developers.line.biz/console/" target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-control border border-hairline px-3 py-2 text-xs font-medium text-accent hover:bg-accent-bg">LINE Loginのチャネル設定を開く ↗</a>
        </FormSection>
      </fieldset>

      <fieldset disabled={!loginReady} className="disabled:opacity-45">
        <FormSection step={5} label="LIFFを設定" note="同じLINE LoginチャネルへLIFFアプリを追加し、Endpoint URLを登録します。">
          <Field label="LIFF ID" htmlFor="liff-id" required><input id="liff-id" value={liffId} onChange={(event) => { setLiffId(event.target.value); setLiffConfigured(false) }} className={`${inputClass} font-mono`} /></Field>
          <AccountSetupUrls liffId={liffId.trim() || null} />
          <div className="mt-3 flex flex-wrap items-center gap-3"><a href="https://developers.line.biz/console/" target="_blank" rel="noreferrer" className="inline-flex rounded-control border border-hairline px-3 py-2 text-xs font-medium text-accent hover:bg-accent-bg">LIFF設定を開く ↗</a><label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={liffConfigured} onChange={(event) => setLiffConfigured(event.target.checked)} className="accent-green-500" />LIFF IDとEndpoint URLを設定しました</label></div>
        </FormSection>
      </fieldset>

      <fieldset disabled={!liffReady} className="disabled:opacity-45">
        <FormSection step={6} label="すべての接続を確認">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {([['messagingApi', 'Messaging API'], ['webhook', 'Webhook'], ['lineLogin', 'LINE Login'], ['liff', 'LIFF']] as const).map(([key, label]) => <div key={key} className={`rounded-control border px-3 py-3 text-sm ${verification?.[key] ? 'border-accent bg-accent-bg text-accent' : 'border-hairline text-ink-faint'}`}>{verification?.[key] ? '✓ ' : '— '}{label}</div>)}
          </div>
          {verification && verification.errors.length > 0 && <ul className="mt-3 rounded-control border border-danger bg-danger-bg px-4 py-3 text-xs text-danger">{verification.errors.map((error) => <li key={error}>・{error}</li>)}</ul>}
          <button type="button" disabled={verifying} onClick={() => void verify()} className="mt-4 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{verifying ? '接続確認中...' : 'Messaging API・Webhook・Login・LIFFを確認'}</button>
          <p className="mt-2 text-xs text-ink-faint">LINE LoginとLIFFはID・Secret・LIFF IDの必須形式を確認します。実際のユーザーログインは追加後の公開導線で確認します。</p>
        </FormSection>
      </fieldset>
    </CreatePage>
  )
}
