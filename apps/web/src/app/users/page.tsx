'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Header from '@/components/layout/header'
import { useEmbeddedPage } from '@/components/layout/embedded-page-context'
import SummaryBar from '@/components/users/summary-bar'
import UsersFilters from '@/components/users/users-filters'
import UsersTable from '@/components/users/users-table'
import { api } from '@/lib/api'
import type { UserRowData } from '@/components/users/user-row'

const PAGE_SIZE = 50

interface AccountOption {
  id: string
  name: string
}

export default function UsersPage() {
  const embedded = useEmbeddedPage()
  const [rows, setRows] = useState<UserRowData[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [onlyDups, setOnlyDups] = useState(false)
  const [account, setAccount] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [accountOptions, setAccountOptions] = useState<AccountOption[]>([])

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedQ, setDebouncedQ] = useState('')
  // フィルタ変更 / ページ移動で複数リクエストが in-flight になり、
  // 古い応答が後着で UI を上書きする事故を防ぐ。
  const requestSeqRef = useRef(0)
  // 次の load() で worker キャッシュをバイパスするフラグ。
  const [pendingForceRefresh, setPendingForceRefresh] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQ(q), 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [q])

  useEffect(() => {
    setPage(1)
  }, [debouncedQ, onlyDups, account])

  // アカウント候補は LINE アカウント API から取得（ページ依存させない）。
  // /api/users-grouped は inactive を除外して集計するので、候補も active のみ。
  useEffect(() => {
    api.lineAccounts.list().then((res) => {
      if (res.success) {
        setAccountOptions(
          res.data
            .filter((a) => a.isActive)
            .map((a) => ({ id: a.id, name: a.name }))
            .sort((x, y) => x.name.localeCompare(y.name)),
        )
      }
    })
  }, [])

  const load = useCallback(async () => {
    const seq = ++requestSeqRef.current
    setLoading(true)
    setError('')
    const force = pendingForceRefresh
    if (force) setRefreshing(true)
    try {
      const res = await api.usersGrouped.list({
        q: debouncedQ || undefined,
        onlyDups: onlyDups || undefined,
        account: account || undefined,
        page,
        pageSize: PAGE_SIZE,
        forceRefresh: force || undefined,
      })
      if (seq !== requestSeqRef.current) return // stale 応答は無視
      if (res.success) {
        setRows(res.data.rows)
        setTotal(res.data.total)
      } else {
        // 失敗時に古い rows を残すと、新しいフィルタ条件で古いデータが見えて誤誘導するのでクリア。
        setRows([])
        setTotal(0)
        setError('取得に失敗しました')
      }
    } catch {
      if (seq !== requestSeqRef.current) return
      setRows([])
      setTotal(0)
      setError('取得に失敗しました')
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false)
        if (force) {
          setRefreshing(false)
          setPendingForceRefresh(false)
        }
      }
    }
  }, [debouncedQ, onlyDups, account, page, pendingForceRefresh])

  useEffect(() => {
    load()
  }, [load])

  const headerDescription = useMemo(
    () => 'LINE 画像トークンで人単位にまとめた一覧。重複・X・フォーム回答を一目で。',
    [],
  )

  return (
    <div className="space-y-4" data-users-design="v4">
      {!embedded ? <Header title="ユーザー一覧" description={headerDescription} /> : null}

      <SummaryBar />

      <div className="flex items-stretch gap-3">
        <div className="flex-1">
          <UsersFilters
            q={q}
            onlyDups={onlyDups}
            account={account}
            accountOptions={accountOptions}
            onChange={(next) => {
              if (next.q !== undefined) setQ(next.q)
              if (next.onlyDups !== undefined) setOnlyDups(next.onlyDups)
              if (next.account !== undefined) setAccount(next.account)
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => setPendingForceRefresh(true)}
          disabled={refreshing}
          className="rounded-[9px] border border-[#DADDE2] bg-white px-4 text-xs font-semibold text-[#565F59] shadow-[1px_1px_2px_rgba(29,29,31,0.13)] hover:bg-[#F6F6F8] disabled:opacity-50"
          title="worker キャッシュをバイパスして再集計"
        >
          {refreshing ? '再計算中…' : '再計算'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      <UsersTable
        rows={rows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        loading={loading}
        onPageChange={setPage}
      />
    </div>
  )
}
