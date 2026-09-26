'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, fetchApi } from '@/lib/api'
import { resolveStoreReturnPath } from '@/lib/hq-navigation'
import { useAccount, type AccountWithStats } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import { usePageTitle } from '@/components/shell/page-chrome'
import HqAccountList from '@/components/hq/account-list'
import AccountEditModal from '@/components/accounts/account-edit-modal'
import KpiCard from '@/components/shared/kpi-card'
import KpiCollapse from '@/components/ui/kpi-collapse'
import OperatorHistory from '@/components/hq/operator-history'
import PlatformNotices from '@/components/hq/platform-notices'

export default function HqPage() {
  // 左のメニューと同じ名前を見出しにする（バナー生成・課金プランなどと同じ書き方）。
  usePageTitle('アカウント')
  const router = useRouter()
  const { setSelectedAccountId, refreshAccounts } = useAccount()
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingAccount, setEditingAccount] = useState<AccountWithStats | null>(null)
  const [checkingConnections, setCheckingConnections] = useState(false)
  const [connectionProgress, setConnectionProgress] = useState('')
  const [connectionResult, setConnectionResult] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(async () => {
    setError('')
    const accountResponse = await api.lineAccounts.list()
    if (!accountResponse.success) throw new Error(accountResponse.error)
    setAccounts(accountResponse.data as AccountWithStats[])
  }, [])

  useEffect(() => {
    let cancelled = false
    void load()
      .catch(() => {
        if (!cancelled) setError('統括のアカウント情報を読み込めませんでした。時間をおいてもう一度お試しください。')
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
    <div data-design-node="MjMCg">
      <PlatformNotices />
      <div data-design="Actions" data-design-node="x5Tkb6" className="mb-4 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={checkingConnections || loading || accounts.length === 0}
          onClick={() => { void refreshConnectionInfo() }}
        >
          {checkingConnections ? '接続情報を更新中' : 'LINE ID・接続状態を更新'}
        </Button>
        <Button href="/accounts/new" variant="primary" className="shrink-0">
          ＋ LINEアカウントを新規登録
        </Button>
      </div>

      {connectionProgress ? <p className="mb-4 text-sm text-ink-secondary" role="status">{connectionProgress}</p> : null}
      {connectionResult ? <p className="mb-4 rounded-card bg-accent-soft p-4 text-sm text-ink" role="status">{connectionResult}</p> : null}

      {error ? (
        <div className="rounded-card bg-danger-bg p-4 text-sm text-danger" role="alert">
          <p>{error}</p>
          <Button
            type="button"
            variant="secondary"
            className="mt-3"
            onClick={() => { setLoading(true); setReloadKey((key) => key + 1) }}
          >
            再読み込み
          </Button>
        </div>
      ) : null}

      {!error && loading ? (
        <div className="flex min-h-64 items-center justify-center" role="status" aria-label="アカウントを読み込み中">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-hairline border-t-accent" />
        </div>
      ) : null}

      {!error && !loading ? (
        <>
          {/* #975 U060: 390pxでは先頭2件だけ出し、残りは「集計を見る」で開く。 */}
          <KpiCollapse data-design="KPIs" data-design-node="w7yY6" className="mb-4" gridClassName="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard variant="v6" title="アカウント" value={accounts.length} unit="件" detail={`有効 ${totals.active}・停止中 ${accounts.length - totals.active}`} />
            <KpiCard variant="v6" title="友だち合計" value={totals.friends} unit="人" detail="" help="全アカウントの合計です" />
            <KpiCard variant="v6" title="今月の配信" value={totals.messages} unit="通" detail="" help={`${month}/1 から今日までの配信です`} />
            <KpiCard variant="v6" title="要確認" value={totals.warnings} unit="件" detail="接続に問題があるアカウント" valueTone="warning" />
          </KpiCollapse>
        </>
      ) : null}

      {!error && !loading && accounts.length === 0 ? (
        <section data-design="Empty" className="rounded-card border border-hairline bg-canvas px-6 py-16 text-center shadow-sm">
          <h2 className="text-xl font-bold text-ink">まだアカウントがありません</h2>
          <p className="mt-2 text-sm text-ink-secondary">最初のLINE公式アカウントを登録すると、ここからアカウントへログインできます。</p>
          <Button href="/accounts/new" variant="primary" className="mt-6">
            ＋ LINEアカウントを新規登録
          </Button>
        </section>
      ) : null}

      {!error && !loading && accounts.length > 0 ? (
        <HqAccountList accounts={accounts} onSelect={login} onSettings={setEditingAccount} />
      ) : null}

      {/* 運営が書き込みを伴う操作をしたときだけ出る（★V6 37-5）。 */}
      <OperatorHistory />

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
