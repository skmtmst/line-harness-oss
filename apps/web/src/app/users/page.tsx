'use client'

import { useState } from 'react'
import SummaryBar from '@/components/users/summary-bar'
import UsersFilters from '@/components/users/users-filters'
import UsersTable from '@/components/users/users-table'
import MergedPersonDetailView from '@/components/merged-person/merged-person-detail'
import MergedPersonDetailViewV8 from '@/components/merged-person/merged-person-detail-v8'
import Button from '@/components/shared/button'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { useMergedUsers, USERS_PAGE_SIZE } from './use-merged-users'
import UsersV8 from './users-v8'

export default function UsersPage() {
  const theme = useAdminTheme()
  if (theme === 'v8') return <UsersV8 />
  return <UsersPageV7 />
}

function UsersPageV7() {
  usePageTitle('統合ユーザー')
  // 絞り込み・読み込み・CSV は use-merged-users.ts が正本（★V8 も同じ口）。
  const {
    rows,
    total,
    page,
    setPage,
    q,
    setQ,
    onlyDups,
    setOnlyDups,
    account,
    setAccount,
    uid,
    setUid,
    loading,
    error,
    accountOptions,
    refreshing,
    setPendingForceRefresh,
    load,
    exporting,
    exportError,
    exportCsv,
  } = useMergedUsers()

  /*
   * 開いている統合ユーザー（設計 `w8W4Eh`）。
   * 同じ画面を二重に作らないため、別のルートは足さず一覧の面を差し替える。
   */
  const [openedPersonId, setOpenedPersonId] = useState<string | null>(null)

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
      {/*
        使い方の説明は毎回読むものではないので、共通 Disclosure が無い
        いまは1行の小さな説明文に留める（カードにしない）。
      */}
      <p className="text-xs leading-5 text-ink-secondary">
        複数の友だちを、1人の顧客として横断管理します。同じ人か確認が必要なものは「要確認」と表示します。
      </p>

      <SummaryBar rows={rows} />

      {/*
        U018: 390pxでは作成・CSV・検索・絞り込みが同じ帯に入り、検索欄が
        細線まで潰れていた。操作（作成・CSV・再計算）の行と、検索・絞り込みの
        行を縦に分ける。検索欄は常に全幅の独立行にし、絞り込みは収まらない
        幅だけ折り返す。共通部品の形は変えず、画面側の scoped style で効かせる。
      */}
      <div className="flex flex-wrap items-center gap-2" data-users-actions="true">
        <Button href="/friends/identity-candidates" variant="primary">
          ＋ 統合ユーザーを作る
        </Button>
        <Button type="button" onClick={() => void exportCsv()} disabled={exporting} className="ml-auto" busy={exporting} busyLabel="書き出し中…">CSVで書き出す
        </Button>
        <Button
          type="button"
          onClick={() => setPendingForceRefresh(true)}
          disabled={refreshing}
          title="最新の状態を取得して一覧を更新" busy={refreshing} busyLabel="再計算中…">再計算
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
        [data-users-filters] [data-design-node="phlR1"] { flex: 1 1 100%; }
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
        pageSize={USERS_PAGE_SIZE}
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
