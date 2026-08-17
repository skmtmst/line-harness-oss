'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import AccountMigration from './migration'
import CcPromptButton from '@/components/cc-prompt-button'
import TestRecipientsSetting from '@/components/accounts/test-recipients-setting'
import AccountSettingsSection from '@/components/accounts/account-settings-section'
import ReorderMode from '@/components/accounts/reorder-mode'
import {
  AccountFormSections,
  emptyAccountFormState,
  type AccountFormState,
} from '@/components/accounts/account-form-fields'
import AccountSetupUrls from '@/components/accounts/account-setup-urls'
import AccountEditModal from '@/components/accounts/account-edit-modal'
import LinkBaseUrlSetting from '@/components/accounts/link-base-url-setting'
import FollowerImportButton from '@/components/accounts/follower-import-button'
import { Suspense } from 'react'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import PoolsPage from '@/app/pools/page'

interface LineAccountListItem {
  id: string
  channelId: string
  name: string
  displayName: string
  pictureUrl: string | null
  basicId: string | null
  isActive: boolean
  loginChannelId: string | null
  liffId: string | null
  createdAt: string
  updatedAt: string
  stats: {
    friendCount: number
    activeScenarios: number
    messagesThisMonth: number
  }
  ogSiteName: string | null
  ogDefaultDescription: string | null
  ogDefaultImageUrl: string | null
  friendCapacity?: number | null
  capacityWarnAt?: number | null
  iconUrl?: string | null
}

const ccPrompts = [
  {
    title: 'LINEアカウント設定確認',
    prompt: `現在登録されているLINEアカウントのチャネル設定を確認してください。
1. 各アカウントのChannel ID・名前・有効/無効ステータスを一覧表示
2. Channel Access TokenとChannel Secretが正しく設定されているか検証
3. LINE Developers Consoleとの設定整合性をチェック
結果をレポートしてください。`,
  },
  {
    title: 'アカウント追加手順',
    prompt: `新しいLINEアカウントを追加する手順をガイドしてください。
1. LINE Developers Consoleでのチャネル作成手順を説明
2. Channel ID、Channel Access Token、Channel Secretの取得方法
3. CRMへの登録手順と初期設定のベストプラクティス
手順を示してください。`,
  },
]

const MERGED_TABS = [
  { key: 'accounts', label: 'LINEアカウント' },
  { key: 'pools', label: 'プール' },
  { key: 'migration', label: 'データ移行' },
]

function AccountsPageInner() {
  const [accounts, setAccounts] = useState<LineAccountListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showReorder, setShowReorder] = useState(false)
  const [editing, setEditing] = useState<LineAccountListItem | null>(null)
  const [form, setForm] = useState<AccountFormState>(emptyAccountFormState)
  const [createError, setCreateError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [justCreated, setJustCreated] = useState<{ liffId: string | null } | null>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.lineAccounts.list()
      if (res.success) {
        setAccounts(res.data as unknown as LineAccountListItem[])
      } else {
        setError('アカウント情報の取得に失敗しました')
      }
    } catch {
      setError('APIに接続できませんでした。サーバーが起動しているか確認してください。')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const updateForm = (partial: Partial<AccountFormState>) =>
    setForm((s) => ({ ...s, ...partial }))

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    if (!form.channelId || !form.name || !form.channelAccessToken || !form.channelSecret) {
      setCreateError('Messaging API の必須項目を入力してください')
      return
    }
    setSubmitting(true)
    try {
      const res = await api.lineAccounts.create({
        channelId: form.channelId.trim(),
        name: form.name.trim(),
        channelAccessToken: form.channelAccessToken.trim(),
        channelSecret: form.channelSecret.trim(),
        loginChannelId: form.loginChannelId.trim() || null,
        loginChannelSecret: form.loginChannelSecret.trim() || null,
        liffId: form.liffId.trim() || null,
        ogSiteName: form.ogSiteName?.trim() || null,
        ogDefaultImageUrl: form.ogDefaultImageUrl?.trim() || null,
        ogDefaultDescription: form.ogDefaultDescription?.trim() || null,
      })
      if (res.success) {
        setJustCreated({ liffId: form.liffId.trim() || null })
        setForm(emptyAccountFormState)
        setShowCreate(false)
        load()
      } else {
        setCreateError(res.error || '登録に失敗しました')
      }
    } catch {
      setCreateError('登録に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このLINEアカウントを削除しますか？')) return
    await api.lineAccounts.delete(id)
    load()
  }

  const handleToggle = async (id: string, currentActive: boolean) => {
    await api.lineAccounts.update(id, { isActive: !currentActive })
    load()
  }

  return (
    <div>
      <div data-design="Head">
      <Header
        title="アカウント"
        description="接続しているLINE公式アカウントと、その束ね方（プール）を管理します。チャネル設定とWebhookの状態も、この画面から確認できます。"
        action={
          <div className="flex flex-wrap gap-2">
            <button
              disabled
              title="マニュアルは準備中です"
              className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-xs font-medium opacity-50"
            >
              マニュアル
            </button>
            <Link
              href="/pools/new"
              className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-3 py-2 text-xs font-medium"
            >
              プールを作成
            </Link>
            <button
              onClick={() => setShowReorder(true)}
              className="px-3 py-2 rounded-lg text-xs font-medium border border-gray-300 hover:bg-gray-50"
            >
              並び替えモード
            </button>
            <button
              onClick={() => {
                const next = !showCreate
                setShowCreate(next)
                if (!next) {
                  setForm(emptyAccountFormState)
                  setCreateError('')
                }
              }}
              className="px-4 py-2 rounded-lg text-white text-sm font-medium"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {showCreate ? 'キャンセル' : 'アカウントを追加'}
            </button>
          </div>
        }
      />
      </div>

      {/* 設計はここに3タブ（LINEアカウント / プール / データ移行）。
          プールは /pools、データ移行は画面そのものが無い。タブごと隠すと
          プールを束ねられること自体が読み取れないので、行き先を出す。 */}
      <div data-design="Tabs" className="border-hairline mb-4 flex flex-wrap gap-1 border-b">
        <span className="border-accent text-accent -mb-px border-b-2 px-4 py-2 text-sm font-medium">
          LINEアカウント
        </span>
        <Link
          href="/pools/new"
          className="text-ink-secondary hover:text-ink -mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium"
        >
          プール
        </Link>
        <button
          disabled
          title="データ移行の画面は準備中です"
          className="text-ink-faint -mb-px cursor-not-allowed border-b-2 border-transparent px-4 py-2 text-sm font-medium opacity-50"
        >
          データ移行
        </button>
      </div>

      <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">接続アカウント</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {accounts.length}
            <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            稼働中 {accounts.filter((a) => a.isActive).length}
          </p>
        </div>
        {/* プールの数はこの画面では引いていない。プール一覧は別のAPI。 */}
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">プール</p>
          <p className="text-ink-faint mt-1 text-2xl font-bold">—</p>
          <p className="text-ink-faint mt-0.5 text-xs">プールの一覧は別画面です</p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">友だち合計</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {accounts.reduce((sum, a) => sum + (a.stats?.friendCount ?? 0), 0).toLocaleString('ja-JP')}
            <span className="text-ink-faint ml-0.5 text-xs font-normal">人</span>
          </p>
          {/* 同じ人が複数アカウントを友だち追加していると二重に数える。
              重複を除いた数は「重複」の画面でしか出せない。 */}
          <p className="text-ink-faint mt-0.5 text-xs">重複を含む延べ数</p>
        </div>
        {/* 発行したWebhook URLと、LINE側の設定が一致しているかを確かめる
            経路が無い。LINE の API を叩かないと分からない。 */}
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">Webhook 一致</p>
          <p className="text-ink-faint mt-1 text-2xl font-bold">—</p>
          <p className="text-ink-faint mt-0.5 text-xs">LINE側の設定は確認できません</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {justCreated && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm font-semibold text-green-800 mb-2">
            ✓ アカウントを登録しました
          </p>
          <p className="text-xs text-green-700 mb-3">
            次に LINE Developers Console で以下の URL を貼り付けてください。
          </p>
          <AccountSetupUrls liffId={justCreated.liffId} heading="登録すべき URL" />
          <button
            onClick={() => setJustCreated(null)}
            className="mt-3 text-xs text-green-700 underline"
          >
            閉じる
          </button>
        </div>
      )}

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-white rounded-lg border border-gray-200 p-6 mb-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              アカウント名 <span className="text-red-500">*</span>
            </label>
            <input
              value={form.name}
              onChange={(e) => updateForm({ name: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="メインアカウント"
              required
            />
          </div>

          <AccountFormSections
            state={form}
            update={updateForm}
            showMessagingRequired={true}
          />

          <AccountSetupUrls liffId={form.liffId.trim() || null} />

          {createError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-xs">
              {createError}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            {submitting ? '登録中...' : '登録'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">読み込み中...</div>
      ) : accounts.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          <p className="mb-2">LINEアカウントが登録されていません</p>
          <p className="text-xs text-gray-300">LINE Developers Console からChannel情報を取得して登録してください</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {accounts.map((account) => (
            <div key={account.id} className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  {account.pictureUrl ? (
                    <img
                      src={account.pictureUrl}
                      alt={account.displayName}
                      className="w-10 h-10 rounded-lg object-cover"
                    />
                  ) : (
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                      style={{ backgroundColor: account.isActive ? 'var(--color-accent)' : '#9CA3AF' }}
                    >
                      {account.displayName?.charAt(0) || 'L'}
                    </div>
                  )}
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">{account.displayName}</h3>
                    <p className="text-xs text-gray-400 font-mono">
                      {account.basicId ? `${account.basicId} · ` : ''}Channel: {account.channelId}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleToggle(account.id, account.isActive)}
                  className={`text-xs px-2 py-0.5 rounded-full ${account.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                >
                  {account.isActive ? '有効' : '無効'}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-4 py-3 border-t border-b border-gray-100">
                <div className="text-center">
                  <p className="text-lg font-bold text-gray-900">{account.stats.friendCount}</p>
                  <p className="text-xs text-gray-400">友だち</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-blue-600">{account.stats.activeScenarios}</p>
                  <p className="text-xs text-gray-400">配信中</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-green-600">{account.stats.messagesThisMonth}</p>
                  <p className="text-xs text-gray-400">今月送信</p>
                </div>
              </div>

              {/* Login/LIFF status badges — at-a-glance signal that an account
                  is fully wired. Important because SQL-only setup historically
                  left rows half-configured (Login/LIFF blank). */}
              <div className="flex gap-2 mb-3 text-[11px]">
                <span
                  className={`px-2 py-0.5 rounded-full ${
                    account.loginChannelId
                      ? 'bg-blue-50 text-blue-700'
                      : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  Login: {account.loginChannelId ? '設定済' : '未設定'}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full ${
                    account.liffId
                      ? 'bg-purple-50 text-purple-700'
                      : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  LIFF: {account.liffId ? '設定済' : '未設定'}
                </span>
              </div>

              <AccountSettingsSection
                accountId={account.id}
                initialCountry={(account as { country?: string | null }).country ?? null}
                initialRole={(account as { role?: string | null }).role ?? null}
                onUpdated={load}
              />
              <TestRecipientsSetting accountId={account.id} />
              <FollowerImportButton accountId={account.id} onImported={load} />

              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs text-gray-400">
                  登録: {new Date(account.createdAt).toLocaleDateString('ja-JP')}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditing(account)}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    編集
                  </button>
                  <button
                    onClick={() => handleDelete(account.id)}
                    className="text-red-500 hover:text-red-700 text-xs"
                  >
                    削除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">グローバル設定</h2>
        <LinkBaseUrlSetting />
      </div>
      <CcPromptButton prompts={ccPrompts} />
      {showReorder && (
        <ReorderMode
          accounts={accounts.map((a) => ({
            id: a.id,
            name: a.name,
            displayName: a.displayName,
            country: (a as { country?: string | null }).country ?? null,
          }))}
          onClose={() => setShowReorder(false)}
          onSaved={load}
        />
      )}
      {editing && (
        <AccountEditModal
          accountId={editing.id}
          initialName={editing.name}
          initialChannelId={editing.channelId}
          initialLoginChannelId={editing.loginChannelId}
          initialLiffId={editing.liffId}
          initialOgSiteName={editing.ogSiteName}
          initialOgDefaultDescription={editing.ogDefaultDescription}
          initialOgDefaultImageUrl={editing.ogDefaultImageUrl}
          initialFriendCapacity={editing.friendCapacity ?? null}
          initialCapacityWarnAt={editing.capacityWarnAt ?? null}
          initialIconUrl={editing.iconUrl ?? null}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}

function AccountsPageHost() {
  const tab = useMergedTab(MERGED_TABS)
  return (
    <div>
      <MergedTabs basePath="/accounts" paramName="tab" tabs={MERGED_TABS} active={tab} />
      {tab === 'accounts' && <AccountsPageInner />}
      {tab === 'pools' && <PoolsPage />}
      {tab === 'migration' && <AccountMigration />}
    </div>
  )
}

export default function AccountsPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <AccountsPageHost />
    </Suspense>
  )
}
