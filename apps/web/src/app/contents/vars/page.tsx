'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { CommonVar, CommonVarSchedule, Folder } from '@line-crm/shared'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import FolderPanel from '@/components/shared/folder-panel'
import { VAR_TYPE_LABELS, formatStamp } from '@/lib/common-vars'

/**
 * 共通情報の一覧。
 *
 * Lステップの「コンテンツ ＞ 共通情報」と同じ形にしてある。
 * 左にフォルダの縦パネル、右に一覧。上に「新しいフォルダ」「新しい共通情報」、
 * 一覧の右肩に並び替えと検索。以前は /contents のタブの片方に入れていたが、
 * サイドバーから直接開けないので、独立した画面にした。
 */

/** 「未分類」を表す絞り込みの値。空文字だと「すべて」と区別できない。 */
const UNGROUPED = '__ungrouped__'

/** 1ページに出す件数。Lステップと同じく、下にページ番号を並べる。 */
const PER_PAGE = 20

function VarsPageInner() {
  const router = useRouter()
  const params = useSearchParams()

  const [items, setItems] = useState<CommonVar[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  /** 変数ID → まだ反映されていない予約。列に出すためだけに持つ。 */
  const [schedules, setSchedules] = useState<Record<string, CommonVarSchedule[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  /** 選んでいるフォルダ。URLに出して、戻るとブックマークを壊さない。 */
  const folderFilter = params.get('folder') ?? ''
  const setFolderFilter = (id: string) => {
    setPage(1)
    router.replace(id ? `/contents/vars?folder=${encodeURIComponent(id)}` : '/contents/vars')
  }

  const [addingFolder, setAddingFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [savingFolder, setSavingFolder] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [vars, folderList] = await Promise.all([
        api.commonVars.list(),
        api.folders.list('common_var'),
      ])
      if (vars.success) setItems(vars.data)
      if (folderList.success) setFolders(folderList.data)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return items.filter((item) => {
      if (folderFilter === UNGROUPED && item.folderId !== null) return false
      if (folderFilter && folderFilter !== UNGROUPED && item.folderId !== folderFilter) return false
      if (!needle) return true
      return (
        item.name.toLowerCase().includes(needle) ||
        item.varKey.toLowerCase().includes(needle) ||
        item.value.toLowerCase().includes(needle)
      )
    })
  }, [items, folderFilter, query])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const current = useMemo(
    () => filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [filtered, page],
  )

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  /*
   * 予約は変数ごとに別のURLで取る（/api/common-vars/:id/schedules）。
   * まとめて返す口が無いので、いま画面に出ている分だけ取りに行く。
   * 全件ぶんを先に取ると、100件あるアカウントで100回叩くことになる。
   */
  useEffect(() => {
    let alive = true
    const missing = current.filter((item) => !(item.id in schedules))
    if (missing.length === 0) return
    void Promise.all(
      missing.map(async (item) => {
        try {
          const res = await api.commonVars.schedules(item.id)
          return [item.id, res.success ? res.data : []] as const
        } catch {
          return [item.id, [] as CommonVarSchedule[]] as const
        }
      }),
    ).then((pairs) => {
      if (!alive) return
      setSchedules((prev) => ({ ...prev, ...Object.fromEntries(pairs) }))
    })
    return () => {
      alive = false
    }
  }, [current, schedules])

  const addFolder = async () => {
    const name = folderName.trim()
    if (!name || savingFolder) return
    setSavingFolder(true)
    setError('')
    try {
      const res = await api.folders.create({ kind: 'common_var', name })
      if (!res.success) {
        setError(res.error)
        return
      }
      setFolderName('')
      setAddingFolder(false)
      void load()
    } catch {
      setError('フォルダを作れませんでした')
    } finally {
      setSavingFolder(false)
    }
  }

  const removeSelected = async () => {
    if (selected.size === 0) return
    if (
      !confirm(
        `${selected.size}件の共通情報を削除しますか？\n` +
          'テンプレートに差し込みが残っていると、その部分が空になります。',
      )
    )
      return
    setError('')
    try {
      for (const id of selected) await api.commonVars.delete(id)
      setSelected(new Set())
      void load()
    } catch {
      setError('削除に失敗しました')
    }
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const allOnPageSelected = current.length > 0 && current.every((item) => selected.has(item.id))

  return (
    <div>
      <div data-design="Head">
        <Header
          title="共通情報"
          description="「会社名」「営業時間」といったアカウント内で共通に使う情報を登録します。テンプレートなどに差し込めるので、変えるときは1か所で済みます。"
          action={
            <button
              disabled
              title="マニュアルは準備中です"
              className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
            >
              マニュアル
            </button>
          }
        />
      </div>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="space-y-3">
          <button
            onClick={() => setAddingFolder(true)}
            className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control w-full border px-3 py-2 text-sm font-medium"
          >
            ＋ 新しいフォルダ
          </button>

          <FolderPanel
            total={`${items.length} 件`}
            activeId={folderFilter}
            onSelect={setFolderFilter}
            rows={[
              { id: '', label: 'すべて', count: items.length },
              {
                id: UNGROUPED,
                label: '未分類',
                count: items.filter((item) => item.folderId === null).length,
              },
              ...folders.map((folder) => ({
                id: folder.id,
                label: folder.name,
                count: items.filter((item) => item.folderId === folder.id).length,
                color: folder.color,
              })),
            ]}
          >
            {addingFolder ? (
              <div className="space-y-2">
                <input
                  type="text"
                  autoFocus
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void addFolder()
                    if (e.key === 'Escape') setAddingFolder(false)
                  }}
                  placeholder="フォルダ名を入力"
                  aria-label="フォルダ名"
                  className="border-hairline rounded-control focus:ring-accent w-full border px-2 py-1.5 text-sm focus:ring-2 focus:outline-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setAddingFolder(false)
                      setFolderName('')
                    }}
                    className="border-hairline text-ink-secondary rounded-control border px-3 py-1 text-xs"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={() => void addFolder()}
                    disabled={!folderName.trim() || savingFolder}
                    className="bg-accent text-on-accent rounded-control px-3 py-1 text-xs font-medium disabled:opacity-40"
                  >
                    決定
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-ink-faint text-xs leading-relaxed">
                フォルダを消しても、入っていた共通情報は未分類として残ります。
              </p>
            )}
          </FolderPanel>
        </div>

        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Link
              href="/contents/vars/new"
              className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium transition-colors"
            >
              ＋ 新しい共通情報
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              {/* 並べ替えの順番を保存する列が common_vars に無い。押せる形で
                  出すと、並べても次に開いたときに戻る。 */}
              <button
                disabled
                title="並び替えは準備中です"
                className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm opacity-50"
              >
                ⇅ 並び替え
              </button>
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setPage(1)
                }}
                placeholder="検索"
                aria-label="共通情報を検索"
                className="border-hairline rounded-control focus:ring-accent w-48 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
              />
            </div>
          </div>

          <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px]">
                <thead>
                  <tr className="bg-canvas-sunken border-hairline border-b">
                    <th className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev)
                            for (const item of current) {
                              if (allOnPageSelected) next.delete(item.id)
                              else next.add(item.id)
                            }
                            return next
                          })
                        }
                        aria-label="このページの共通情報をすべて選ぶ"
                        className="accent-green-500"
                      />
                    </th>
                    <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold">
                      共通情報名
                    </th>
                    <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold">
                      種別
                    </th>
                    <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold">値</th>
                    <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold">
                      スケジュール
                    </th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="text-ink-faint px-4 py-8 text-center text-sm">
                        読み込み中...
                      </td>
                    </tr>
                  ) : current.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-ink-faint px-4 py-8 text-center text-sm">
                        {items.length === 0
                          ? '共通情報が作成されていません'
                          : 'この条件に合う共通情報はありません'}
                      </td>
                    </tr>
                  ) : (
                    current.map((item) => {
                      const pending = (schedules[item.id] ?? []).filter((s) => !s.appliedAt)
                      return (
                        <tr key={item.id} className="hover:bg-canvas-sunken">
                          <td className="px-3 py-3">
                            <input
                              type="checkbox"
                              checked={selected.has(item.id)}
                              onChange={() => toggle(item.id)}
                              aria-label={`${item.name}を選ぶ`}
                              className="accent-green-500"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <Link
                              href={`/contents/vars/edit?id=${item.id}`}
                              className="text-info text-sm font-medium hover:underline"
                            >
                              {item.name}
                            </Link>
                            {/* 差し込みの書き方を一覧に出す。編集画面を開かないと
                                分からないと、テンプレートを書く手が止まる。 */}
                            <code className="text-ink-faint block text-xs">{`{{var.${item.varKey}}}`}</code>
                          </td>
                          <td className="px-4 py-3">
                            <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-xs">
                              {VAR_TYPE_LABELS[item.type] ?? item.type}
                            </span>
                          </td>
                          <td className="text-ink max-w-[18rem] truncate px-4 py-3 text-sm">
                            {item.value || <span className="text-ink-faint">（空）</span>}
                          </td>
                          <td className="text-ink-secondary px-4 py-3 text-xs">
                            {pending.length === 0 ? (
                              <span className="text-ink-faint">—</span>
                            ) : (
                              <>
                                {formatStamp(pending[0].effectiveFrom)} から
                                <span className="text-ink-faint"> → {pending[0].value || '（空）'}</span>
                                {pending.length > 1 && (
                                  <span className="text-ink-faint"> ほか{pending.length - 1}件</span>
                                )}
                              </>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Link
                              href={`/contents/vars/edit?id=${item.id}`}
                              className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded border px-2 py-1 text-xs"
                            >
                              編集
                            </Link>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <nav className="flex items-center gap-1" aria-label="ページ送り">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="前のページ"
                className="border-hairline text-ink-secondary rounded-control border px-2 py-1 text-sm disabled:opacity-30"
              >
                &lt;
              </button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  onClick={() => setPage(n)}
                  aria-current={n === page ? 'page' : undefined}
                  className={`rounded-control px-3 py-1 text-sm tabular-nums ${
                    n === page
                      ? 'bg-accent text-on-accent'
                      : 'border-hairline text-ink-secondary hover:bg-canvas-sunken border'
                  }`}
                >
                  {n}
                </button>
              ))}
              <button
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={page >= pageCount}
                aria-label="次のページ"
                className="border-hairline text-ink-secondary rounded-control border px-2 py-1 text-sm disabled:opacity-30"
              >
                &gt;
              </button>
            </nav>

            <button
              onClick={() => void removeSelected()}
              disabled={selected.size === 0}
              className="border-danger-bg text-danger hover:bg-danger-bg rounded-control border px-3 py-2 text-sm font-medium disabled:opacity-40"
            >
              選択した共通情報を削除
              {selected.size > 0 && <span className="tabular-nums">（{selected.size}）</span>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function CommonVarsPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <VarsPageInner />
    </Suspense>
  )
}
