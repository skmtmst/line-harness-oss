'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import TestRecipientsSetting from '@/components/accounts/test-recipients-setting'
import AccountSettingsSection from '@/components/accounts/account-settings-section'
import ReorderMode from '@/components/accounts/reorder-mode'
import AccountEditModal from '@/components/accounts/account-edit-modal'
import LinkBaseUrlSetting from '@/components/accounts/link-base-url-setting'
import FollowerImportButton from '@/components/accounts/follower-import-button'
import { Suspense } from 'react'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import AccountHierarchy from './account-hierarchy'

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
  parentLineAccountId: string | null
}

const MERGED_TABS = [
  { key: 'accounts', label: 'アカウント一覧' },
  { key: 'hierarchy', label: 'LINEアカウント構成' },
]

function AccountsPageInner() {
  const [accounts, setAccounts] = useState<LineAccountListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showReorder, setShowReorder] = useState(false)
  const [editing, setEditing] = useState<LineAccountListItem | null>(null)

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
        description="接続しているLINE公式アカウントを管理します。"
        action={
          <div className="flex flex-wrap gap-2">
            <button
              disabled
              title="マニュアルは準備中です"
              className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-xs font-medium opacity-50"
            >
              マニュアル
            </button>
            <button
              onClick={() => setShowReorder(true)}
              className="px-3 py-2 rounded-lg text-xs font-medium border border-gray-300 hover:bg-gray-50"
            >
              並び替えモード
            </button>
            <Link
              href="/accounts/new"
              className="px-4 py-2 rounded-lg text-white text-sm font-medium"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              アカウントを追加
            </Link>
          </div>
        }
      />
      </div>

      <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
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
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
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
      <div data-design="Tabs">
        <MergedTabs basePath="/accounts" paramName="tab" tabs={MERGED_TABS} active={tab} />
      </div>
      {tab === 'accounts' && <AccountsPageInner />}
      {tab === 'hierarchy' && <AccountHierarchy />}
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
