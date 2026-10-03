'use client'

import ReadonlyHeader from './readonly-header-v8'
import AccountBrowser from './account-browser-v8'
import './readonly-v8.css'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, fetchApi } from '@/lib/api'
import { resolveStoreReturnPath } from '@/lib/hq-navigation'
import { useAccount, type AccountWithStats } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import { classifyApiFailure, loadFailureNotice } from '@/components/shared/api-error-message'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { usePageTitle } from '@/components/shell/page-chrome'
import HqAccountList from '@/components/hq/account-list'
import AccountEditModal from '@/components/accounts/account-edit-modal'
import { AccountArchiveDialog, AccountRestoreDialog, AccountSettingsDialog } from './account-settings-dialogs'
import KpiCard from '@/components/shared/kpi-card'
import KpiCollapse from '@/components/ui/kpi-collapse'
import OperatorHistory from '@/components/hq/operator-history'
import PlatformNotices from '@/components/hq/platform-notices'

export default function HqPage() {
  const theme = useAdminTheme()
  // 左のメニューと同じ名前を見出しにする（バナー生成・課金プランなどと同じ書き方）。
  usePageTitle('アカウント')
  const router = useRouter()
  const { setSelectedAccountId, refreshAccounts } = useAccount()
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])
  const [loading, setLoading] = useState(true)
  // M021：捕まえた失敗を持ち、共通部品へ渡す（403 は権限の案内になる）。
  const [loadError, setLoadError] = useState<unknown>(null)
  const [editingAccount, setEditingAccount] = useState<AccountWithStats | null>(null)
  /* 板 `HMpVx`・`D6ljr`・`HFsO9`：カードの「設定」から開く3つの窓。 */
  const [settingsAccount, setSettingsAccount] = useState<AccountWithStats | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<{ account: AccountWithStats; mode: 'archive' | 'restore' } | null>(null)
  const [checkingConnections, setCheckingConnections] = useState(false)
  const [connectionProgress, setConnectionProgress] = useState('')
  const [connectionResult, setConnectionResult] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(async () => {
    setLoadError(null)
    const accountResponse = await api.lineAccounts.list()
    if (!accountResponse.success) throw new Error(accountResponse.error)
    setAccounts(accountResponse.data as AccountWithStats[])
  }, [])

  useEffect(() => {
    let cancelled = false
    void load()
      .catch((caught: unknown) => {
        if (!cancelled) setLoadError(caught)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [load, reloadKey])

  const reloadAfterSave = async () => {
    await Promise.all([load(), refreshAccounts()])
  }

  const refreshConnectionInfo = async () => {
    if (checkingConnections || accounts.length === 0) return
    setCheckingConnections(true)
    setConnectionResult('')
    let succeeded = 0
    let failed = 0
    for (const [index, account] of accounts.entries()) {
      setConnectionProgress(`接続情報を更新中（${index + 1}/${accounts.length}）`)
      const expectedRevision = account.revision
      if (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
        failed += 1
        continue
      }
      try {
        await fetchApi(`/api/line-accounts/${encodeURIComponent(account.id)}/connection-checks`, {
          method: 'POST',
          headers: { 'Idempotency-Key': `hq-check-${account.id}-${crypto.randomUUID()}` },
          body: JSON.stringify({ expectedRevision }),
        })
        succeeded += 1
      } catch {
        failed += 1
      }
    }
    try {
      await Promise.all([load(), refreshAccounts()])
      setConnectionResult(failed === 0
        ? `${succeeded}件のLINE IDと接続状態を更新しました。`
        : `${succeeded}件を更新し、${failed}件は更新できませんでした。`)
    } catch {
      setConnectionResult(`${succeeded}件を確認しましたが、一覧を再読み込みできませんでした。`)
    } finally {
      setConnectionProgress('')
      setCheckingConnections(false)
    }
  }

  const login = (accountId: string) => {
    setSelectedAccountId(accountId)
    // 店舗未選択ゲートから来たときは、元いた画面（通知の編集など）へ戻す。
    // `return` はアプリ内の店舗画面パスだけを受け付ける（NEXT-07）。
    const back = resolveStoreReturnPath(new URLSearchParams(window.location.search).get('return'))
    router.push(back ?? '/')
  }

  const totals = useMemo(() => accounts.reduce((sum, account) => ({
    friends: sum.friends + (account.stats?.friendCount ?? 0),
    messages: sum.messages + (account.stats?.messagesThisMonth ?? 0),
    warnings: sum.warnings + (account.connection?.status === 'warn' ? 1 : 0),
    active: sum.active + (account.isActive ? 1 : 0),
  }), { friends: 0, messages: 0, warnings: 0, active: 0 }), [accounts])
  const month = new Date().getMonth() + 1

  return (
    <div data-design-node={theme === 'v8' ? 'JKjsE' : 'MjMCg'} className="v8-ro-hq-page flex flex-col gap-4">
      {/* カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。子ごとの mb/mt は付けない。 */}
      {theme === 'v8' && <ReadonlyHeader title="統括のアカウント" description="各アカウントの接続状態、友だち、配信の状況を確認できます。" />}
      <PlatformNotices />
      <div data-design="Actions" data-design-node="x5Tkb6" className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={checkingConnections || loading || accounts.length === 0}
          onClick={() => { void refreshConnectionInfo() }} busy={checkingConnections} busyLabel="接続情報を更新中">LINE ID・接続状態を更新する
        </Button>
        {theme !== 'v8' && <Button href="/accounts/new" variant="primary" className="shrink-0">
          ＋ LINEアカウントを登録する
        </Button>}
      </div>

      {connectionProgress ? <p className="mb-4 text-sm text-ink-secondary" role="status">{connectionProgress}</p> : null}
      {connectionResult ? <Notice tone="info" message={connectionResult} className="mb-4" /> : null}

      {/*
        M021：読み込み 403 は権限不足として区別する。再試行口は残すが、
        403（押しても直らない）には出さない。
      */}
      {loadError ? (
        <Notice
          tone="danger"
          message={loadFailureNotice(loadError, '統括のアカウント情報')}
          action={
            classifyApiFailure(loadError) === 'forbidden' ? undefined : (
              <Button
                type="button"
                variant="secondary"
                onClick={() => { setLoading(true); setReloadKey((key) => key + 1) }}
              >
                再読み込み
              </Button>
            )
          }
        />
      ) : null}

      {!loadError && loading ? (
        <div className="flex min-h-64 items-center justify-center" role="status" aria-label="アカウントを読み込み中">
          <div className="h-8 w-8 animate-spin rounded-pill border-4 border-hairline border-t-accent" />
        </div>
      ) : null}

      {!loadError && !loading ? (
        <>
          {/* #975 U060: 390pxでは先頭2件だけ出し、残りは「集計を見る」で開く。 */}
          <KpiCollapse data-ro-kpis data-design="KPIs" data-design-node="w7yY6" gridClassName="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard variant="v6" title="アカウント" value={accounts.length} unit="件" detail={`有効 ${totals.active}・停止中 ${accounts.length - totals.active}`} />
            <KpiCard variant="v6" title="友だち合計" value={totals.friends} unit="人" detail="" help="全アカウントの合計です" />
            <KpiCard variant="v6" title="今月の配信" value={totals.messages} unit="通" detail="" help={`${month}/1 から今日までの配信です`} />
            <KpiCard variant="v6" title="要確認" value={totals.warnings} unit="件" detail="接続に問題があるアカウント" valueTone="warning" />
          </KpiCollapse>
        </>
      ) : null}

      {!loadError && !loading && accounts.length === 0 ? (
        <ListState
          kind="empty"
          data-design="Empty"
          title="まだアカウントがありません"
          description="最初のLINE公式アカウントを登録すると、ここからアカウントへログインできます。"
          action={<Button href="/accounts/new" variant="primary">＋ LINEアカウントを登録する</Button>}
        />
      ) : null}

      {!loadError && !loading && accounts.length > 0 ? (
        theme === 'v8' ? <AccountBrowser accounts={accounts} onSelect={login} onSettings={setSettingsAccount} /> : <HqAccountList accounts={accounts} onSelect={login} onSettings={setSettingsAccount} />
      ) : null}

      {/* 運営が書き込みを伴う操作をしたときだけ出る（★V6 37-5）。 */}
      <OperatorHistory />

      {settingsAccount ? (
        <AccountSettingsDialog
          account={settingsAccount}
          accounts={accounts}
          archived={Boolean((settingsAccount as { archivedAt?: string | null }).archivedAt)}
          onClose={() => setSettingsAccount(null)}
          onSaved={() => {
            setSettingsAccount(null)
            void reloadAfterSave()
          }}
          onArchive={() => {
            setArchiveTarget({ account: settingsAccount, mode: (settingsAccount as { archivedAt?: string | null }).archivedAt ? 'restore' : 'archive' })
            setSettingsAccount(null)
          }}
          onShowDetails={() => {
            setEditingAccount(settingsAccount)
            setSettingsAccount(null)
          }}
        />
      ) : null}

      {archiveTarget?.mode === 'archive' ? (
        <AccountArchiveDialog
          account={archiveTarget.account}
          onClose={() => setArchiveTarget(null)}
          onDone={() => {
            setArchiveTarget(null)
            void reloadAfterSave()
          }}
        />
      ) : null}

      {archiveTarget?.mode === 'restore' ? (
        <AccountRestoreDialog
          account={archiveTarget.account}
          onClose={() => setArchiveTarget(null)}
          onDone={() => {
            setArchiveTarget(null)
            void reloadAfterSave()
          }}
        />
      ) : null}

      {editingAccount ? (
        <AccountEditModal
          accountId={editingAccount.id}
          initialName={editingAccount.name}
          initialChannelId={editingAccount.channelId}
          initialLoginChannelId={editingAccount.loginChannelId ?? null}
          initialLiffId={editingAccount.liffId ?? null}
          initialOgSiteName={editingAccount.ogSiteName ?? null}
          initialOgDefaultDescription={editingAccount.ogDefaultDescription ?? null}
          initialOgDefaultImageUrl={editingAccount.ogDefaultImageUrl ?? null}
          initialFriendCapacity={editingAccount.friendCapacity ?? null}
          initialCapacityWarnAt={editingAccount.capacityWarnAt ?? null}
          initialIconUrl={editingAccount.iconUrl ?? null}
          onClose={() => setEditingAccount(null)}
          onSaved={() => { void reloadAfterSave() }}
        />
      ) : null}
    </div>
  )
}
