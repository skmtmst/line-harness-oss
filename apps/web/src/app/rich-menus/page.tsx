'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import { ApplyToTagModal } from '@/components/rich-menus/apply-to-tag-modal'
import type { RichMenuTapStats } from '@/lib/api'
import type { Folder } from '@line-crm/shared'
import FolderPanel from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import Pagination from '@/components/shared/pagination'

/** フォルダに入れていないものを選ぶための、内部だけの値。 */
const UNFILED = '__unfiled__'

type SortKey = 'taps' | 'updated' | 'name' | 'manual'

/**
 * よく使う絞り込み。
 *
 * 「よく使う」は、押された回数が多いものを指す。設計に語として入っているが、
 * 何をもって「よく使う」かは決まっていなかったので、**数えられるもの**で
 * 定義した。数えられない言葉を画面に置くと、押しても何も起きない。
 */
const SAVED_FILTERS: { key: string; label: string; note: string }[] = [
  { key: 'used', label: 'よく使う', note: '今月1回以上押されたメニュー' },
  { key: 'published', label: '公開中のみ', note: 'LINE に登録済みのメニュー' },
  { key: 'draft', label: '下書きのみ', note: 'まだ LINE に登録していないメニュー' },
]

type RichMenuGroupListItem = {
  id: string
  name: string
  chatBarText: string
  size: 'large' | 'compact'
  status: 'draft' | 'published'
  isDefaultForAll: boolean
  targetingEnabled: boolean
  targetingCondition: string | null
  /** 159: フォルダ。分けていなければ null。 */
  folderId: string | null
  /** 160: 自分で決める並び順。 */
  displayOrder: number
  thumbnailR2Key: string | null
  updatedAt: string
}

function StatusBadge({ status }: { status: 'draft' | 'published' }) {
  const cls =
    status === 'published'
      ? 'bg-success-bg text-success'
      : 'bg-canvas-sunken text-ink-secondary'
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${cls}`}>
      {status === 'published' ? 'LINE 登録済み' : '下書き'}
    </span>
  )
}

type LineMenu = {
  richMenuId: string
  name: string
  chatBarText: string
  size: { width: number; height: number }
  areasCount: number
  isCurrentDefault: boolean
  adminManaged: boolean
  adminInfo: {
    groupId: string
    groupName: string
    pageName: string
    groupStatus: 'draft' | 'published'
  } | null
}

export default function RichMenusListPage() {
  const { selectedAccount } = useAccount()
  const activeAccountRef = useRef<string | null>(selectedAccount?.id ?? null)
  const [groups, setGroups] = useState<RichMenuGroupListItem[]>([])
  const [query, setQuery] = useState('')
  const [external, setExternal] = useState<{
    currentDefault: string | null
    lineMenus: LineMenu[]
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [externalError, setExternalError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applyTo, setApplyTo] = useState<RichMenuGroupListItem | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  /** 選んでいるフォルダ。空は「すべて」、UNFILED は「未分類」。 */
  const [folderFilter, setFolderFilter] = useState('')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('taps')
  const [savedFilter, setSavedFilter] = useState('')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [reordering, setReordering] = useState(false)
  const [tapStats, setTapStats] = useState<RichMenuTapStats | null>(null)

  useEffect(() => {
    activeAccountRef.current = selectedAccount?.id ?? null
    setGroups([])
    setExternal(null)
    setTapStats(null)
    setError(null)
    setExternalError(null)
    setApplyTo(null)
    setPage(1)
    if (!selectedAccount?.id) setLoading(false)
  }, [selectedAccount?.id])

  const reload = useCallback(async () => {
    if (!selectedAccount?.id) {
      setLoading(false)
      return
    }
    const accountId = selectedAccount.id
    setLoading(true)
    setGroups([])
    setExternal(null)
    setTapStats(null)
    setError(null)
    setExternalError(null)
    try {
      // 並列に: D1 管理 group の一覧と、LINE 上の現状
      const [groupsRes, externalRes, tapRes] = await Promise.allSettled([
        api.richMenuGroups.list(accountId),
        api.richMenuGroups.external(accountId),
        api.richMenuGroups.tapStats(accountId),
      ])
      if (activeAccountRef.current !== accountId) return
      // 数が取れなくても一覧は出す。集計は付随情報なので、落ちても本体は止めない。
      setTapStats(
        tapRes.status === 'fulfilled' && tapRes.value.success ? tapRes.value.data : null,
      )
      if (groupsRes.status === 'fulfilled') {
        if (!groupsRes.value.success) throw new Error(groupsRes.value.error ?? '取得失敗')
        setGroups(groupsRes.value.data)
      } else {
        throw groupsRes.reason
      }
      if (externalRes.status === 'fulfilled') {
        const v = externalRes.value
        if (v.success) {
          setExternal(v.data)
        } else {
          setExternalError(v.error ?? 'LINE 上の状態取得に失敗')
          setExternal(null)
        }
      } else {
        setExternalError(
          externalRes.reason instanceof Error
            ? externalRes.reason.message
            : String(externalRes.reason),
        )
        setExternal(null)
      }
    } catch (e) {
      if (activeAccountRef.current === accountId) {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      if (activeAccountRef.current === accountId) setLoading(false)
    }
  }, [selectedAccount?.id])

  const loadFolders = useCallback(async () => {
    const res = await api.folders.list('rich_menu')
    if (res.success) setFolders(res.data)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])
  useEffect(() => {
    void loadFolders()
  }, [loadFolders])

  const [reorderBusy, setReorderBusy] = useState(false)

  /**
   * 1つ上／下と順番を入れ替える。
   *
   * 画面に出ている並びの中で入れ替える。フォルダや絞り込みで隠れているものは
   * 動かさない。見えていないものが動くと、何が起きたか分からなくなる。
   */
  async function moveGroup(group: RichMenuGroupListItem, delta: number) {
    // ページ送りで隠れている行も含めた現在の絞り込み結果を基準にする。
    // 表示中の20件だけで0から振り直すと、2ページ目以降が1ページ目と
    // 同じ displayOrder になり、次回の並びが不定になる。
    const list = sorted
    const index = list.findIndex((g) => g.id === group.id)
    const target = list[index + delta]
    if (!target) return
    setReorderBusy(true)
    try {
      // 同じ数字どうしだと入れ替えても並びが変わらない。並んでいる位置を
      // そのまま番号にして、確実に前後が入れ替わるようにする。
      await Promise.all([
        api.richMenuGroups.update(group.id, { displayOrder: index + delta }),
        api.richMenuGroups.update(target.id, { displayOrder: index }),
      ])
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setReorderBusy(false)
    }
  }

  async function handleDelete(group: RichMenuGroupListItem) {
    if (group.status === 'published') {
      alert(
        `「${group.name}」は LINE に登録されています。\n\n` +
          '編集画面の「危険な操作」から「LINE から取り下げ」を実行してから、改めて削除してください。',
      )
      return
    }
    if (!confirm(`「${group.name}」を削除します。元には戻せません。`)) return
    try {
      const res = await api.richMenuGroups.delete(group.id)
      if (!res.success) throw new Error(res.error ?? '削除失敗')
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleDeleteExternal(menu: LineMenu) {
    if (!selectedAccount?.id) return
    if (
      !confirm(
        `LINE 上のリッチメニュー「${menu.name}」(richMenuId: ${menu.richMenuId.slice(0, 14)}...) を削除します。\n\n` +
          'この管理画面外で作成されたメニューを LINE 公式アカウントから消します。元に戻せません。\n\n続行しますか？',
      )
    )
      return
    try {
      const res = await api.richMenuGroups.deleteExternal(menu.richMenuId, selectedAccount.id)
      if (!res.success) throw new Error(res.error ?? '削除失敗')
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleImport(menu: LineMenu) {
    if (!selectedAccount?.id) return
    if (
      !confirm(
        `「${menu.name}」を管理画面に取り込みます。\n\n` +
          '取り込み後は「管理画面で作成・編集するメニュー」セクションに表示され、編集や友だちへの再適用が可能になります。\n\n続行しますか？',
      )
    )
      return
    try {
      const res = await api.richMenuGroups.importFromLine(menu.richMenuId, selectedAccount.id)
      if (!res.success) throw new Error(res.error ?? '取り込み失敗')
      alert(`取り込みました: ${res.data?.name ?? menu.name}`)
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  // メニュー名とトークバーの文言を見る。名前だけだと、画面に出ている
  // 文言（chatBarText）で探せない。
  // 集計は多い順に並んでいる。先頭がいちばん押されたボタン。
  const topArea = tapStats?.byArea[0] ?? null
  const tapsByGroup = new Map((tapStats?.byGroup ?? []).map((g) => [g.groupId, g.taps]))
  const targetingCount = groups.filter((g) => g.targetingEnabled && g.targetingCondition).length

  const q = query.trim()
  const byQuery = q
    ? groups.filter((g) => g.name.includes(q) || g.chatBarText.includes(q))
    : groups
  const inFolder = byQuery.filter((g) => {
    if (folderFilter === UNFILED) return !g.folderId
    if (folderFilter) return g.folderId === folderFilter
    return true
  })

  const inSaved = inFolder.filter((g) => {
    if (savedFilter === 'published') return g.status === 'published'
    if (savedFilter === 'draft') return g.status === 'draft'
    if (savedFilter === 'used') return (tapsByGroup.get(g.id) ?? 0) > 0
    return true
  })

  // 並び替えは元の配列を壊さないよう写してから。
  const sorted = [...inSaved].sort((a, b) => {
    switch (sortKey) {
      case 'taps':
        return (tapsByGroup.get(b.id) ?? 0) - (tapsByGroup.get(a.id) ?? 0)
      case 'name':
        return a.name.localeCompare(b.name, 'ja')
      case 'updated':
        return b.updatedAt.localeCompare(a.updatedAt)
      case 'manual':
        // 自分で決めた順。同じ数字なら更新の新しい順（一覧の既定と同じ）。
        return a.displayOrder - b.displayOrder || b.updatedAt.localeCompare(a.updatedAt)
    }
  })

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const shownGroups = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  useEffect(() => {
    setPage(1)
  }, [folderFilter, pageSize, query, savedFilter, sortKey])

  return (
    <main data-design-node="GO8RQ" className="p-6 max-w-7xl mx-auto">
      <div data-design="KPIs" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">メニュー</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {groups.length}
            <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            公開中 {groups.filter((g) => g.status === 'published').length}
          </p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">今月のタップ</p>
          <p className={`mt-1 text-2xl font-bold tabular-nums ${tapStats ? 'text-ink' : 'text-ink-faint'}`}>
            {tapStats ? tapStats.total : '—'}
            {tapStats && <span className="text-ink-faint ml-0.5 text-xs font-normal">回</span>}
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            {tapStats ? 'ボタンが押された回数' : '集計を取れませんでした'}
          </p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">最多タップ</p>
          <p
            className={`mt-1 truncate text-2xl font-bold ${topArea ? 'text-ink' : 'text-ink-faint'}`}
            title={topArea?.label ?? undefined}
          >
            {topArea ? (topArea.label || '名前のないボタン') : '—'}
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            {topArea
              ? `${topArea.taps}回・タップ数の内訳は編集画面で見られます`
              : 'まだ押されていません'}
          </p>
        </div>
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">出し分け</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {targetingCount}
            <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">
            {targetingCount > 0
              ? 'タグ条件で自動的に切り替わります'
              : 'タグ条件で出し分けているメニューはありません'}
          </p>
        </div>
      </div>

      <div
        data-design="Bar"
        className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3"
      >
        <Link
          href="/rich-menus/new"
          className="bg-accent text-on-accent hover:bg-accent-hover rounded-control inline-flex items-center gap-1 px-4 py-2 text-sm font-medium transition-colors"
        >
          メニューを作る
        </Link>
        <button
          onClick={() => setFolderDialogOpen(true)}
          className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-4 py-2 text-sm font-medium transition-colors"
        >
          フォルダを追加
        </button>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="メニュー名で検索"
          aria-label="メニュー名で検索"
          className="border-hairline rounded-control focus:ring-accent min-w-0 flex-1 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
        />
        <span className="text-ink-faint text-xs whitespace-nowrap">並び順</span>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          aria-label="並び順"
          className="border-hairline rounded-control focus:ring-accent border px-2 py-2 text-sm focus:ring-2 focus:outline-none"
        >
          <option value="taps">タップ数が多い順</option>
          <option value="updated">更新が新しい順</option>
          <option value="name">名前順</option>
          <option value="manual">自分で決めた順</option>
        </select>
        <span className="text-ink-faint text-xs whitespace-nowrap">表示</span>
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          aria-label="表示件数"
          className="border-hairline rounded-control focus:ring-accent border px-2 py-2 text-sm focus:ring-2 focus:outline-none"
        >
          {[20, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n}件
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            // 並び替えは「自分で決めた順」で見ているときだけ意味がある。
            // 他の順で上下させても、次に開いたときその順で並ばない。
            setSortKey('manual')
            setReordering((v) => !v)
          }}
          aria-pressed={reordering}
          className={`rounded-control border px-4 py-2 text-sm font-medium transition-colors ${
            reordering
              ? 'border-accent bg-accent-soft text-ink'
              : 'border-hairline text-ink-secondary hover:bg-canvas-sunken'
          }`}
        >
          {reordering ? '並び替えを終える' : '出す順番を変える'}
        </button>
      </div>

      <div data-design="Saved" className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-ink-faint text-xs whitespace-nowrap">保存した条件</span>
        {SAVED_FILTERS.map((f) => {
          const on = savedFilter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setSavedFilter(on ? '' : f.key)}
              aria-pressed={on}
              title={f.note}
              className={`rounded-pill border px-3 py-1 text-xs transition-colors ${
                on
                  ? 'border-accent bg-accent-soft text-ink'
                  : 'border-hairline text-ink-secondary hover:bg-canvas-sunken'
              }`}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {!selectedAccount && (
        <div className="text-sm text-ink-faint">
          アカウントを選択してください。
        </div>
      )}

      {selectedAccount && loading && (
        <div className="text-sm text-ink-faint">読み込み中...</div>
      )}

      {selectedAccount && !loading && error && (
        <div className="bg-danger-bg border border-danger-bg text-danger text-sm p-3 rounded mb-4">
          <p>{error}</p>
          <button type="button" className="mt-2 underline" onClick={() => void reload()}>
            もう一度読み込む
          </button>
        </div>
      )}

      {/* LINE 公式アカウントの現状 (admin 管理外の rich menu も含む) */}
      {selectedAccount && !loading && external && (
        <ExternalSection
          accountId={selectedAccount.id}
          accountName={selectedAccount.displayName || selectedAccount.name}
          external={external}
          onDeleteExternal={handleDeleteExternal}
          onImport={handleImport}
        />
      )}
      {selectedAccount && !loading && externalError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs p-3 rounded mb-6">
          LINE 公式アカウントの状態取得に失敗しました: {externalError}
        </div>
      )}

      {folderDialogOpen && (
        <FolderAddDialog
          kind="rich_menu"
          note="メニューを分けてしまう箱です。消しても、入っていたメニューは未分類として残ります。"
          placeholder="例: 01_会員向け"
          onClose={() => setFolderDialogOpen(false)}
          onAdded={() => void loadFolders()}
        />
      )}

      {/* Admin 管理メニュー見出し */}
      {selectedAccount && !loading && !error && (
        <h2 className="text-sm font-semibold text-ink-secondary mb-3">
          管理画面で作成・編集するメニュー
        </h2>
      )}

      {selectedAccount && !loading && !error && shownGroups.length === 0 && (
        <div className="bg-white border border-hairline rounded-lg shadow-sm p-12 text-center">
          <p className="text-ink-faint mb-4">
            まだリッチメニューが作成されていません。
          </p>
          <Link
            href="/rich-menus/new"
            className="bg-accent text-on-accent transition-colors hover:bg-accent-hover inline-flex items-center gap-1 rounded-control px-4 py-2 text-sm font-medium"
          >
            <span className="text-lg leading-none">+</span> 最初のメニューを作る
          </Link>
        </div>
      )}

      {selectedAccount && !loading && !error && (
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <FolderPanel
            total={`${groups.length} 件`}
            activeId={folderFilter}
            onSelect={setFolderFilter}
            rows={[
              { id: '', label: 'すべて', count: groups.length },
              ...folders.map((f) => ({
                id: f.id,
                label: f.name,
                count: groups.filter((g) => g.folderId === f.id).length,
                color: f.color,
              })),
              {
                id: UNFILED,
                label: '未分類',
                count: groups.filter((g) => !g.folderId).length,
              },
            ]}
          >
            <p className="text-ink-faint text-xs leading-relaxed">
              フォルダを消しても、入っていたメニューは未分類として残ります。
            </p>
          </FolderPanel>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {shownGroups.map((g) => (
            <div
              key={g.id}
              className="bg-white border border-hairline rounded-lg shadow-sm hover:shadow-md transition-shadow flex flex-col"
            >
              <Link
                href={`/rich-menus/edit?id=${g.id}`}
                className="flex-1 hover:bg-canvas-sunken rounded-t-lg overflow-hidden"
              >
                {/* thumbnail */}
                <div
                  className="w-full bg-canvas-sunken border-b border-hairline"
                  style={{
                    aspectRatio: g.size === 'large' ? '2500 / 1686' : '2500 / 843',
                  }}
                >
                  {g.thumbnailR2Key ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={api.richMenuGroups.imageUrl(g.thumbnailR2Key)}
                      alt={g.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-ink-faint">
                      画像未設定
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <h2 className="font-semibold text-ink truncate">{g.name}</h2>
                    <StatusBadge status={g.status} />
                  </div>
                  <p className="text-sm text-ink-faint truncate">
                    トーク表示: <span className="text-ink-secondary">{g.chatBarText}</span>
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                    <span className="whitespace-nowrap">
                      サイズ: {g.size === 'large' ? '2500×1686' : '2500×843'}
                    </span>
                    {tapStats && (
                      <span className="whitespace-nowrap">
                        今月 <span className="text-ink-secondary tabular-nums">
                          {tapsByGroup.get(g.id) ?? 0}
                        </span> 回
                      </span>
                    )}
                    {g.targetingEnabled && g.targetingCondition && (
                      <span className="text-accent font-medium whitespace-nowrap">条件で出し分け</span>
                    )}
                    {g.isDefaultForAll && (
                      <span className="text-blue-600 font-medium whitespace-nowrap">
                        ★ 全員のデフォルト
                      </span>
                    )}
                  </div>
                </div>
              </Link>
              {reordering && (
                <div className="border-hairline bg-canvas-sunken flex items-center justify-between gap-2 border-t px-4 py-2">
                  <span className="text-ink-faint text-[11px]">並び順 {g.displayOrder}</span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => void moveGroup(g, -1)}
                      disabled={reorderBusy}
                      className="border-hairline rounded-control hover:bg-canvas border px-2 py-0.5 text-xs disabled:opacity-40"
                      aria-label="上へ"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => void moveGroup(g, 1)}
                      disabled={reorderBusy}
                      className="border-hairline rounded-control hover:bg-canvas border px-2 py-0.5 text-xs disabled:opacity-40"
                      aria-label="下へ"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              )}
              <div className="border-t border-hairline px-4 py-2.5 flex justify-end gap-4 text-xs">
                {g.status === 'published' && (
                  <button
                    onClick={() => setApplyTo(g)}
                    className="text-accent font-medium hover:underline"
                  >
                    友だちに表示
                  </button>
                )}
                <Link
                  href={`/rich-menus/edit?id=${g.id}`}
                  className="text-ink-secondary hover:underline"
                >
                  編集
                </Link>
                <Link
                  href={`/rich-menus/connections?id=${encodeURIComponent(g.id)}`}
                  className="text-ink-secondary hover:underline"
                >
                  切替のつながりを見る
                </Link>
                <button
                  onClick={() => handleDelete(g)}
                  className="text-ink-faint hover:text-red-600 hover:underline"
                  title={g.status === 'published' ? 'LINE から取り下げてから削除' : '削除'}
                >
                  削除
                </button>
              </div>
            </div>
          ))}
          </div>
        </div>
      )}

      {selectedAccount && !loading && !error && sorted.length > 0 && (
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="text-ink-faint text-xs">
            {(currentPage - 1) * pageSize + 1}〜{Math.min(currentPage * pageSize, sorted.length)}件 / 全{sorted.length}件
          </p>
          <Pagination
            page={currentPage}
            pageCount={pageCount}
            onPageChange={setPage}
            ariaLabel="リッチメニューのページ送り"
          />
        </div>
      )}

      {applyTo && (
        <ApplyToTagModal
          groupId={applyTo.id}
          groupName={applyTo.name}
          onClose={() => setApplyTo(null)}
        />
      )}
    </main>
  )
}

function ExternalSection({
  accountId,
  accountName,
  external,
  onDeleteExternal,
  onImport,
}: {
  accountId: string
  accountName: string
  external: { currentDefault: string | null; lineMenus: LineMenu[] }
  onDeleteExternal: (menu: LineMenu) => void
  onImport: (menu: LineMenu) => void
}) {
  const { currentDefault, lineMenus } = external
  const sortedMenus = [...lineMenus].sort((a, b) => {
    // 現在のデフォルトを先頭、次に admin 管理外、最後に admin 管理
    if (a.isCurrentDefault) return -1
    if (b.isCurrentDefault) return 1
    if (a.adminManaged !== b.adminManaged) return a.adminManaged ? 1 : -1
    return a.name.localeCompare(b.name)
  })
  const currentDefaultMenu = lineMenus.find((m) => m.isCurrentDefault) ?? null
  const unmanagedCount = lineMenus.filter((m) => !m.adminManaged).length

  return (
    <section className="mb-8 bg-white border border-hairline rounded-lg shadow-sm p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-ink">
          LINE 公式アカウントの現状
        </h2>
        <span className="text-xs text-ink-faint truncate">{accountName}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 text-sm">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-xs text-blue-700 font-medium mb-0.5">
            現在の「全員のデフォルト」
          </div>
          {currentDefaultMenu ? (
            <div>
              <div className="font-medium text-ink truncate">
                {currentDefaultMenu.name}
              </div>
              {currentDefaultMenu.adminInfo ? (
                <div className="text-xs text-ink-secondary truncate">
                  管理画面: {currentDefaultMenu.adminInfo.groupName}
                </div>
              ) : (
                <div className="text-xs text-amber-700">管理画面外で設定</div>
              )}
            </div>
          ) : (
            <div className="text-ink-faint text-xs">設定なし</div>
          )}
          {currentDefault && (
            <div className="text-[10px] text-ink-faint font-mono mt-1 truncate">
              {currentDefault}
            </div>
          )}
        </div>
        <div className="bg-canvas-sunken border border-hairline rounded-lg p-3">
          <div className="text-xs text-ink-secondary font-medium mb-0.5">
            LINE 上に登録されているメニュー
          </div>
          <div className="font-medium text-ink">{lineMenus.length} 個</div>
          {unmanagedCount > 0 && (
            <div className="text-xs text-amber-700">
              うち {unmanagedCount} 個が管理画面外
            </div>
          )}
        </div>
      </div>

      {lineMenus.length === 0 ? (
        <div className="text-xs text-ink-faint py-3">
          LINE 公式アカウントにはまだ rich menu が登録されていません。
        </div>
      ) : (
        <div className="border border-hairline rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-canvas-sunken">
              <tr className="text-left text-xs font-medium text-ink-secondary">
                <th className="px-3 py-2 w-[88px]">画像</th>
                <th className="px-3 py-2">名前</th>
                <th className="px-3 py-2">サイズ</th>
                <th className="px-3 py-2">管理状態</th>
                <th className="px-3 py-2 w-px"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedMenus.map((m) => (
                <tr key={m.richMenuId} className="text-ink-secondary">
                  <td className="px-3 py-2.5">
                    <div
                      className="w-20 bg-canvas-sunken rounded overflow-hidden"
                      style={{
                        aspectRatio:
                          m.size.width === 2500 && m.size.height === 1686
                            ? '2500 / 1686'
                            : m.size.width === 2500 && m.size.height === 843
                              ? '2500 / 843'
                              : `${m.size.width} / ${m.size.height}`,
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={api.richMenuGroups.externalImageUrl(m.richMenuId, accountId)}
                        alt={m.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      {m.isCurrentDefault && (
                        <span
                          className="text-[10px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded"
                          title="LINE 公式アカウントの全員のデフォルト"
                        >
                          DEFAULT
                        </span>
                      )}
                      <span className="font-medium truncate max-w-[180px]">{m.name}</span>
                    </div>
                    <div className="text-[11px] text-ink-faint truncate max-w-[200px]">
                      {m.chatBarText}
                    </div>
                    <div className="text-[10px] text-ink-faint font-mono truncate max-w-[280px]">
                      {m.richMenuId}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-ink-secondary whitespace-nowrap">
                    {m.size.width}×{m.size.height}
                    <div className="text-[10px] text-ink-faint">{m.areasCount} エリア</div>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {m.adminManaged && m.adminInfo ? (
                      <Link
                        href={`/rich-menus/edit?id=${m.adminInfo.groupId}`}
                        className="text-ink-secondary hover:underline"
                      >
                        管理画面 → {m.adminInfo.groupName}
                        <span className="text-ink-faint ml-1">({m.adminInfo.pageName})</span>
                      </Link>
                    ) : (
                      <span
                        className="text-amber-700 font-medium"
                        title="LINE 公式マネージャー、または旧 MCP/CLI から作成された可能性"
                      >
                        管理画面外
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {!m.adminManaged && (
                      <div className="flex flex-col items-end gap-1">
                        <button
                          onClick={() => onImport(m)}
                          className="text-accent text-xs font-medium hover:underline"
                          title="管理画面に取り込んで以後 UI で操作可能にする"
                        >
                          管理画面に取り込む
                        </button>
                        <button
                          onClick={() => onDeleteExternal(m)}
                          className="text-xs text-ink-faint hover:text-red-600 hover:underline"
                          title="LINE から削除 (管理画面外メニューのみ)"
                        >
                          LINE から削除
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
