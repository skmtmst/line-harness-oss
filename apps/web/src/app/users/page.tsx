'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SummaryBar from '@/components/users/summary-bar'
import UsersFilters from '@/components/users/users-filters'
import UsersTable from '@/components/users/users-table'
import MergedPersonDetailView from '@/components/merged-person/merged-person-detail'
import Button from '@/components/shared/button'
import { api } from '@/lib/api'
import { csvCell } from '@/lib/presentation'
import type { UserRowData } from '@/components/users/user-row'
import { usePageTitle } from '@/components/shell/page-chrome'

const PAGE_SIZE = 50

interface AccountOption {
  id: string
  name: string
}

export default function UsersPage() {
  usePageTitle('統合ユーザー')
  const [rows, setRows] = useState<UserRowData[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [onlyDups, setOnlyDups] = useState(false)
  const [account, setAccount] = useState('')
  const [uid, setUid] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [accountOptions, setAccountOptions] = useState<AccountOption[]>([])

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedQ, setDebouncedQ] = useState('')
  // フィルタ変更 / ページ移動で複数リクエストが in-flight になり、
  // 古い応答が後着で UI を上書きする事故を防ぐ。
  const requestSeqRef = useRef(0)
  // 次の load() で最新状態を取り直すフラグ。
  const [pendingForceRefresh, setPendingForceRefresh] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  /*
   * 開いている統合ユーザー（設計 `w8W4Eh`）。
   * 同じ画面を二重に作らないため、別のルートは足さず一覧の面を差し替える。
   */
  const [openedPersonId, setOpenedPersonId] = useState<string | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQ(q), 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [q])

  useEffect(() => {
    // FRIEND-09: UID条件も含めて条件変更時は1ページへ戻す。
    setPage(1)
  }, [debouncedQ, onlyDups, account, uid])

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
        // FRIEND-09: UID絞り込みはサーバーへ渡し、全件へ適用する。
        uid: uid === 'linked' || uid === 'unlinked' ? uid : undefined,
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
        setError('取得に失敗しました。もう一度読み込んでください。')
      }
    } catch {
      if (seq !== requestSeqRef.current) return
      setRows([])
      setTotal(0)
      setError('取得に失敗しました。もう一度読み込んでください。')
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false)
        if (force) {
          setRefreshing(false)
          setPendingForceRefresh(false)
        }
      }
    }
  }, [debouncedQ, onlyDups, account, uid, page, pendingForceRefresh])

  useEffect(() => {
    load()
  }, [load])

  /*
   * FRIEND-09/10: CSV は「表示中の条件」に合う全件を対象にする。
   * 以前は表示中ページの50行だけを出していたため、UID条件を掛けた画面と
   * 書き出しの対象がずれていた。1回の応答上限（200件）で順に取り、
   * 件数と同じだけ集まるまで続ける。
   * セル整形は共通の csvCell（先頭 = + - @ への ' 付け + 引用符の二重化）。
   */
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const exportCsv = async () => {
    if (exporting) return
    setExporting(true)
    setExportError('')
    try {
      const filters = {
        q: debouncedQ || undefined,
        onlyDups: onlyDups || undefined,
        account: account || undefined,
        uid: uid === 'linked' || uid === 'unlinked' ? uid : undefined,
      } as const
      const all: UserRowData[] = []
      let exportTotal = total
      // 上限は途中で件数が増えても無限に追い続けないための安全弁。
      for (let p = 1; all.length < exportTotal && p <= 500; p += 1) {
        const res = await api.usersGrouped.list({ ...filters, page: p, pageSize: 200 })
        if (!res.success) throw new Error('fetch failed')
        all.push(...res.data.rows)
        exportTotal = res.data.total
        if (res.data.rows.length === 0) break
      }
      const lines = [
        ['統合ユーザー', '連絡先', '紐付くアカウント', 'UID', '最終接触'].map(csvCell).join(','),
        ...all.map((row) => [
          row.displayName ?? '', row.emails[0] ?? row.phones[0] ?? '',
          row.accounts.map((item) => item.accountName).join('・'),
          row.identityKeyKind === 'uid' ? '連携済み' : row.identityKeyKind === 'url_token' ? '要確認' : '未連携',
          row.lastActivityAt,
        ].map(csvCell).join(',')),
      ]
      const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'merged-users.csv'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      setExportError('CSVを書き出せませんでした。時間をおいてやり直してください。')
    } finally {
      setExporting(false)
    }
  }

  if (openedPersonId) {
    return (
      <div className="space-y-4" data-users-design="v6">
        <MergedPersonDetailView
          personId={openedPersonId}
          onClose={() => setOpenedPersonId(null)}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4" data-users-design="v6" data-design-node="r7eSi">
      <section className="rounded-card border border-hairline bg-canvas px-4 py-3 shadow-card">
        <p className="text-sm font-bold text-ink">
          複数の友だちを、1人の顧客として横断管理します。
        </p>
        <p className="mt-1 text-xs leading-5 text-ink-secondary">
          元の友だちは残したまま、登録アカウント・最終接触・重複配信の確認ができます。同じ人か確認が必要なものは「要確認」と表示します。
        </p>
      </section>

      <SummaryBar rows={rows} />

      {/*
        U018: 390pxでは作成・CSV・検索・絞り込みが同じ帯に入り、検索欄が
        細線まで潰れていた。操作（作成・CSV・再計算）の行と、検索・絞り込みの
        行を縦に分ける。検索欄は常に全幅の独立行にし、絞り込みは収まらない
        幅だけ折り返す。共通部品の形は変えず、画面側の scoped style で効かせる。
      */}
      <div className="flex flex-wrap items-center gap-2" data-users-actions="true">
        <Button href="/friends/identity-candidates" variant="primary">
          ＋ 統合ユーザーを作成
        </Button>
        <Button type="button" onClick={() => void exportCsv()} disabled={exporting} className="ml-auto">
          {exporting ? '書き出し中…' : 'CSVで書き出す'}
        </Button>
        <Button
          type="button"
          onClick={() => setPendingForceRefresh(true)}
          disabled={refreshing}
          title="最新の状態を取得して一覧を更新"
        >
          {refreshing ? '再計算中…' : '再計算'}
        </Button>
      </div>
      <div data-users-filters>
        <UsersFilters
          q={q}
          onlyDups={onlyDups}
          account={account}
          uid={uid}
          accountOptions={accountOptions}
          onChange={(next) => {
            if (next.q !== undefined) setQ(next.q)
            if (next.onlyDups !== undefined) setOnlyDups(next.onlyDups)
            if (next.account !== undefined) setAccount(next.account)
            if (next.uid !== undefined) setUid(next.uid)
          }}
        />
      </div>
      <style>{`
        [data-users-filters] > div { flex-wrap: wrap; }
        [data-users-filters] input[type="search"] { flex: 1 1 100%; }
        /* U041: 7列の表は狭い幅で見出しが衝突する。列同士の比較が要る表なので、
           収まらない幅では枠の内側だけ横へ動かして見出しの形を保つ。 */
        [data-scroll-table] > div { overflow-x: auto; }
        [data-scroll-table] table { min-width: 860px; }
      `}</style>

      {exportError ? <p className="text-xs text-danger" role="alert">{exportError}</p> : null}

      {/* U041: 見出し同士の衝突を、枠の内側の横移動で避ける。 */}
      <div data-scroll-table>
      <UsersTable
        rows={rows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        loading={loading}
        error={Boolean(error)}
        onRetry={() => void load()}
        onPageChange={setPage}
        onOpenMergedPerson={setOpenedPersonId}
      />
      </div>
    </div>
  )
}
