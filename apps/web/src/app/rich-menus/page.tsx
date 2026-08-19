'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import { ApplyToTagModal } from '@/components/rich-menus/apply-to-tag-modal'
import type { RichMenuTapStats } from '@/lib/api'

type RichMenuGroupListItem = {
  id: string
  name: string
  chatBarText: string
  size: 'large' | 'compact'
  status: 'draft' | 'published'
  isDefaultForAll: boolean
  targetingEnabled: boolean
  targetingCondition: string | null
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
  const [tapStats, setTapStats] = useState<RichMenuTapStats | null>(null)

  const reload = useCallback(async () => {
    if (!selectedAccount?.id) return
    setLoading(true)
    setError(null)
    setExternalError(null)
    try {
      // 並列に: D1 管理 group の一覧と、LINE 上の現状
      const [groupsRes, externalRes, tapRes] = await Promise.allSettled([
        api.richMenuGroups.list(selectedAccount.id),
        api.richMenuGroups.external(selectedAccount.id),
        api.richMenuGroups.tapStats(selectedAccount.id),
      ])
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
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedAccount?.id])

  useEffect(() => {
    reload()
  }, [reload])

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
  const shownGroups = q
    ? groups.filter((g) => g.name.includes(q) || g.chatBarText.includes(q))
    : groups

  return (
    <main className="p-6 max-w-7xl mx-auto">
      <div data-design="Head">
        <Header
          title="リッチメニュー"
          description="トーク画面の下に表示されるメニューを作ります。友だちの状態ごとに出し分けでき、タップ数を計測できます。"
          action={
            <div className="flex flex-wrap gap-2">
              <button
                disabled
                title="マニュアルは準備中です"
                className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
              >
                マニュアル
              </button>
              <button
                disabled
                title="並び替えは準備中です"
                className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
              >
                並び替え
              </button>
              {/* リッチメニューにフォルダを持たせる列が無い。 */}
              <button
                disabled
                title="フォルダは準備中です"
                className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
              >
                フォルダを追加
              </button>
              <Link
                href="/rich-menus/new"
                className="bg-accent text-on-accent hover:bg-accent-hover rounded-control inline-flex items-center gap-1 px-4 py-2 text-sm font-medium transition-colors"
              >
                メニューを作成
              </Link>
            </div>
          }
        />
      </div>

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
          disabled
          title="並び替えは準備中です"
          className="border-hairline rounded-control border px-2 py-2 text-sm opacity-50"
        >
          <option>タップ数が多い順</option>
        </select>
        <span className="text-ink-faint text-xs whitespace-nowrap">表示</span>
        <select
          disabled
          title="表示件数の切り替えは準備中です"
          className="border-hairline rounded-control border px-2 py-2 text-sm opacity-50"
        >
          <option>20件</option>
        </select>
      </div>

      <div data-design="Saved" className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-ink-faint text-xs whitespace-nowrap">保存した条件</span>
        {['よく使う', '公開中のみ', '下書きのみ'].map((label) => (
          <button
            key={label}
            disabled
            title="保存した条件は準備中です"
            className="border-hairline text-ink-faint rounded-pill border px-3 py-1 text-xs opacity-50"
          >
            {label}
          </button>
        ))}
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
          {error}
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

      {selectedAccount && !loading && !error && shownGroups.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
