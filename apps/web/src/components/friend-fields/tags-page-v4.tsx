'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Tag, TagGroup } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import FriendFieldList from './field-list'
import SupportMarkList from './mark-list'
import SavedSearchList from './saved-search-list'

const TABS = [
  ['tags', 'タグ'],
  ['fields', '友だち情報欄'],
  ['marks', '対応マーク'],
  ['searches', '保存した検索'],
] as const
type TabKey = (typeof TABS)[number][0]
const UNGROUPED = '__ungrouped__'
const cardShadow = '[box-shadow:1px_1px_1px_rgba(15,23,42,0.14)]'

export const FRIEND_ATTRIBUTES_QA_GROUPS: TagGroup[] = [
  { id: 'qa-vip', name: 'VIP', sortOrder: 0, color: '#F59E0B', createdAt: '', updatedAt: '' },
  { id: 'qa-pet', name: 'ペット', sortOrder: 1, color: '#EC4899', createdAt: '', updatedAt: '' },
  { id: 'qa-member', name: '会員', sortOrder: 2, color: '#10B981', createdAt: '', updatedAt: '' },
  { id: 'qa-purchase', name: '購入', sortOrder: 3, color: '#3B82F6', createdAt: '', updatedAt: '' },
]

export const FRIEND_ATTRIBUTES_QA_TAGS: Tag[] = [
  ['EC顧客連携済み', 'qa-purchase', 5, 10, 0, 12000],
  ['LINEログイン連携済み', 'qa-member', 5, 0, 0, null],
  ['NEN会員', 'qa-member', 5, 10, 5, 15000],
  ['商品到着確認対象', 'qa-purchase', 3, 1, 0, null],
  ['未契約', '', 3, 0, 0, null],
  ['誕生日クーポン対象', 'qa-vip', 0, 20, 0, null],
].map(([name, groupId, friendCount, mileageReward, referralMileageReward, mileageMultiplierBps], index) => ({
  id: `qa-${index}`,
  name: String(name),
  color: '#8b938d',
  groupId: String(groupId),
  friendCount: Number(friendCount),
  mileageReward: Number(mileageReward),
  referralMileageReward: Number(referralMileageReward),
  mileageMultiplierBps: mileageMultiplierBps == null ? null : Number(mileageMultiplierBps),
  mileageMultiplierPriority: 0,
  isStarred: index < 2,
  displayOrder: index,
  createdAt: '2026-01-13T00:00:00.000Z',
}))

function FolderList({ groups, items, active, onSelect }: { groups: TagGroup[]; items: Tag[]; active: string; onSelect: (id: string) => void }) {
  const rows = [
    { id: '', name: 'すべて', count: items.length, color: '#06c755' },
    ...groups.map((group) => ({ id: group.id, name: group.name, count: items.filter((tag) => tag.groupId === group.id).length, color: group.color ?? '#8b938d' })),
    { id: UNGROUPED, name: '未分類', count: items.filter((tag) => !tag.groupId).length, color: '#c3c8c4' },
  ]
  return (
    <aside className={`h-fit overflow-hidden rounded-card border border-hairline bg-canvas ${cardShadow}`}>
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3"><h2 className="text-sm font-bold text-ink">フォルダ</h2><span className="text-xs text-ink-faint">{items.length}件</span></div>
      <nav className="p-2">{rows.map((row) => <button key={row.id} type="button" onClick={() => onSelect(row.id)} className={`flex w-full items-center gap-2 rounded-control px-3 py-2.5 text-left text-sm ${active === row.id ? 'bg-accent-soft font-semibold text-accent' : 'text-ink-secondary hover:bg-canvas-sunken'}`}><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} /><span className="min-w-0 flex-1 truncate">{row.name}</span><span className="text-xs tabular-nums text-ink-faint">{row.count}</span></button>)}</nav>
      <p className="border-t border-hairline px-4 py-3 text-[11px] leading-5 text-ink-faint">フォルダを削除しても、中のタグは未分類として残ります。</p>
    </aside>
  )
}

function DeleteTagDialog({ tag, onCancel, onDeleted }: { tag: Tag; onCancel: () => void; onDeleted: () => void }) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const remove = async () => {
    if (text !== tag.name || saving) return
    setSaving(true)
    try {
      const result = await api.tags.delete(tag.id)
      if (!result.success) throw new Error(result.error)
      onDeleted()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '削除に失敗しました')
      setSaving(false)
    }
  }
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/45 p-4">
      <section className="w-full max-w-[680px] rounded-card border border-hairline bg-canvas p-7 shadow-2xl" role="alertdialog" aria-modal="true">
        <h2 className="text-xl font-bold text-ink">「{tag.name}」を削除しますか？</h2><p className="mt-2 text-sm text-ink-secondary">削除前に、影響する人数と参照先を確認してください。</p>
        <dl className="mt-5 divide-y divide-hairline overflow-hidden rounded-control border border-hairline text-sm"><div className="flex justify-between px-4 py-3"><dt>タグが付いている友だち</dt><dd className="font-bold">{tag.friendCount ?? 0}人</dd></div><div className="flex justify-between px-4 py-3"><dt>配信・シナリオなどの参照</dt><dd className="font-bold">3件</dd></div><div className="flex justify-between px-4 py-3"><dt>自動付与の参照</dt><dd className="font-bold">1件</dd></div><div className="flex justify-between px-4 py-3"><dt>連動アクション</dt><dd className="font-bold">停止</dd></div><div className="flex justify-between px-4 py-3"><dt>すでに積んだマイル</dt><dd className="font-bold">そのまま残る</dd></div></dl>
        <p className="mt-4 rounded-control border border-danger/25 bg-danger-bg p-3 text-sm font-medium text-danger">外部連携で使用中の場合は削除できません。この操作は元に戻せません。</p>
        <label className="mt-5 block"><span className="mb-1.5 block text-xs font-semibold text-ink-secondary">確認のため「{tag.name}」と入力してください</span><input value={text} onChange={(event) => setText(event.target.value)} className="w-full rounded-control border border-hairline px-3 py-2.5 text-sm outline-none focus:border-danger" /></label>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onCancel} className="rounded-control border border-hairline px-4 py-2.5 text-sm font-medium text-ink-secondary">キャンセル</button><button type="button" disabled={saving || text !== tag.name} onClick={() => void remove()} className="rounded-control bg-danger px-4 py-2.5 text-sm font-bold text-on-accent disabled:opacity-40">{saving ? '削除中…' : 'タグを削除'}</button></div>
      </section>
    </div>
  )
}

export default function TagsPageV4({ fixture }: { fixture?: { items: Tag[]; groups: TagGroup[] } }) {
  const router = useRouter()
  const params = useSearchParams()
  const rawTab = params.get('tab')
  const routeTab: TabKey = TABS.some(([key]) => key === rawTab) ? rawTab as TabKey : 'tags'
  const [fixtureTab, setFixtureTab] = useState<TabKey>('tags')
  const tab = fixture ? fixtureTab : routeTab
  const [items, setItems] = useState<Tag[]>(fixture?.items ?? [])
  const [groups, setGroups] = useState<TagGroup[]>(fixture?.groups ?? [])
  const [loading, setLoading] = useState(!fixture)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [folder, setFolder] = useState('')
  const [usageFilter, setUsageFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [quick, setQuick] = useState('')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [reordering, setReordering] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null)

  const load = useCallback(async () => {
    if (fixture) return
    setLoading(true)
    setError('')
    try {
      const [tags, folders] = await Promise.all([api.tags.list({ withCounts: true }), api.tagGroups.list()])
      if (tags.success) setItems(tags.data)
      if (folders.success) setGroups(folders.data)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [fixture])
  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => items.filter((tag) => {
    if (query && !tag.name.toLowerCase().includes(query.toLowerCase())) return false
    if (folder === UNGROUPED && tag.groupId) return false
    if (folder && folder !== UNGROUPED && tag.groupId !== folder) return false
    const linked = Boolean(tag.mileageReward || tag.referralMileageReward || tag.mileageMultiplierBps)
    if (usageFilter === 'linked' && !linked) return false
    if (usageFilter === 'unused' && (tag.friendCount ?? 0) > 0) return false
    if (sourceFilter === 'manual' && linked) return false
    if (quick === 'unused' && (tag.friendCount ?? 0) > 0) return false
    if (quick === 'linked' && !linked) return false
    return true
  }), [items, query, folder, usageFilter, sourceFilter, quick])
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pages)
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  useEffect(() => setPage(1), [query, folder, usageFilter, sourceFilter, quick, pageSize])

  const move = async (targetId: string) => {
    if (!dragId || dragId === targetId) return setDragId(null)
    const order = filtered.map((tag) => tag.id)
    const from = order.indexOf(dragId); const to = order.indexOf(targetId)
    setDragId(null)
    if (from < 0 || to < 0) return
    order.splice(to, 0, ...order.splice(from, 1))
    const rank = new Map(order.map((id, index) => [id, index]))
    setItems((current) => [...current].sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999)))
    const result = await api.tags.reorder(order)
    if (!result.success) { setError(result.error); void load() }
  }

  const exportCsv = () => {
    const rows = filtered.map((tag) => [tag.name, tag.friendCount ?? 0, groups.find((group) => group.id === tag.groupId)?.name ?? '未分類'])
    const csv = [['タグ名', '付与人数', 'フォルダ'], ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'tags.csv'; anchor.click(); URL.revokeObjectURL(url)
  }

  return (
    <div>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-[32px] font-bold tracking-tight text-ink">友だち属性</h1><p className="mt-1 text-sm text-ink-secondary">タグ・情報欄・対応マーク・保存条件を、用途まで見ながら管理します。</p></div>{tab === 'tags' && <div className="flex flex-wrap gap-2"><button type="button" className="rounded-control border border-hairline bg-canvas px-3 py-2 text-sm text-ink-secondary">マニュアル</button><button type="button" onClick={exportCsv} className="rounded-control border border-hairline bg-canvas px-3 py-2 text-sm text-ink-secondary">CSVで一括登録</button><button type="button" onClick={() => setReordering((value) => !value)} className={`rounded-control border px-3 py-2 text-sm ${reordering ? 'border-accent bg-accent-soft text-accent' : 'border-hairline bg-canvas text-ink-secondary'}`}>{reordering ? '並び替えを終了' : '並び替え'}</button><Link href="/tags/folders/new" className="rounded-control border border-hairline bg-canvas px-3 py-2 text-sm text-ink-secondary">フォルダを追加</Link><Link href="/tags/new" className="rounded-control bg-accent px-4 py-2 text-sm font-bold text-on-accent">＋ タグを追加</Link></div>}</header>
      <nav className="mb-4 flex flex-wrap gap-2">{TABS.map(([key, label]) => <button key={key} type="button" onClick={() => fixture ? setFixtureTab(key) : router.replace(key === 'tags' ? '/tags' : `/tags?tab=${key}`)} className={`rounded-pill px-4 py-2 text-sm font-medium ${tab === key ? 'bg-accent text-on-accent' : 'border border-hairline bg-canvas text-ink-secondary'}`}>{label}</button>)}</nav>

      {tab === 'tags' ? <>
        <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">{[
          ['タグ数', items.length, '件', `未使用 ${items.filter((tag) => (tag.friendCount ?? 0) === 0).length}件`],
          ['付与済み友だち', items.reduce((sum, tag) => sum + (tag.friendCount ?? 0), 0), '人', '1つ以上のタグあり'],
          ['今月の付与', items.reduce((sum, tag) => sum + (tag.friendCount ?? 0), 0), '回', '手動・自動の合計'],
          ['整理候補', items.filter((tag) => (tag.friendCount ?? 0) === 0).length, '件', '未使用・確認待ち'],
        ].map(([title, value, unit, detail]) => <section key={String(title)} className={`rounded-card border border-hairline bg-canvas p-4 ${cardShadow}`}><p className="text-xs font-medium text-ink-secondary">{title}</p><p className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}<span className="ml-1 text-xs font-normal text-ink-secondary">{unit}</span></p><p className="mt-1 text-[11px] text-ink-faint">{detail}</p></section>)}</div>
        {error && <p className="mb-4 rounded-control border border-danger/20 bg-danger-bg p-3 text-sm text-danger">{error}</p>}
        <div className="grid min-w-0 gap-4 xl:grid-cols-[270px_minmax(0,1fr)]">
          <FolderList groups={groups} items={items} active={folder} onSelect={setFolder} />
          <main className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タグ名・用途で検索" className="min-w-[260px] flex-1 rounded-control border border-hairline bg-canvas px-3 py-2.5 text-sm outline-none focus:border-accent" /><select value={usageFilter} onChange={(event) => setUsageFilter(event.target.value)} className="rounded-control border border-hairline bg-canvas px-3 py-2.5 text-sm"><option value="all">使用状態：すべて</option><option value="linked">連動あり</option><option value="unused">未使用</option></select><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className="rounded-control border border-hairline bg-canvas px-3 py-2.5 text-sm"><option value="all">付与元：すべて</option><option value="manual">手動のみ</option></select><select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="rounded-control border border-hairline bg-canvas px-3 py-2.5 text-sm">{[20,30,40,50].map((size) => <option key={size} value={size}>{size}件表示</option>)}</select><span className="text-xs tabular-nums text-ink-faint">{filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} / {filtered.length}件</span></div>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs"><span className="text-ink-faint">よく使う</span>{[['unused','未使用のタグ'],['linked','連動あり'],['recent','今月増えた']].map(([key,label]) => <button key={key} type="button" onClick={() => setQuick(quick === key ? '' : key)} className={`rounded-pill border px-3 py-1.5 ${quick === key ? 'border-accent bg-accent-soft text-accent' : 'border-hairline bg-canvas text-ink-secondary'}`}>{label}</button>)}</div>
            {reordering && <p className="mb-3 rounded-control bg-action-soft px-3 py-2 text-xs text-action">左端のつまみをドラッグすると、その場で順番を保存します。</p>}
            <div className={`overflow-hidden rounded-card border border-hairline bg-canvas ${cardShadow}`}>
              <table className="w-full table-fixed text-sm"><thead className="border-b border-hairline bg-canvas-sunken text-[11px] text-ink-faint"><tr><th className="w-8 px-2 py-3" /><th className="w-[18%] px-3 py-3 text-left">タグ</th><th className="w-[15%] px-3 py-3 text-left">フォルダ</th><th className="w-[9%] px-3 py-3 text-left">付与人数</th><th className="w-[15%] px-3 py-3 text-left">自動付与のもと</th><th className="w-[18%] px-3 py-3 text-left">連動（マイル・アクション）</th><th className="w-[10%] px-3 py-3 text-left">使用先</th><th className="w-[9%] px-3 py-3 text-left">登録日</th><th className="w-[6%] px-2 py-3 text-left">操作</th></tr></thead>
                <tbody className="divide-y divide-hairline">{loading ? <tr><td colSpan={9} className="p-8 text-center text-ink-faint">読み込み中…</td></tr> : visible.length === 0 ? <tr><td colSpan={9} className="p-8 text-center text-ink-faint">条件に合うタグはありません</td></tr> : visible.map((tag) => { const group = groups.find((item) => item.id === tag.groupId); const linked = Boolean(tag.mileageReward || tag.referralMileageReward || tag.mileageMultiplierBps); return <tr key={tag.id} className="hover:bg-canvas-sunken"><td draggable={reordering} onDragStart={() => setDragId(tag.id)} onDragOver={(event) => reordering && event.preventDefault()} onDrop={() => reordering && void move(tag.id)} className={`px-2 py-3 text-center text-ink-faint ${reordering ? 'cursor-grab' : 'opacity-30'}`}>⋮</td><td className="px-3 py-3"><div className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: group?.color ?? '#8b938d' }} /><span className="truncate font-medium text-ink" title={tag.name}>{tag.name}</span></div></td><td className="px-3 py-3"><select value={tag.groupId ?? ''} onChange={async (event) => { await api.tags.setGroup(tag.id, event.target.value || null); void load() }} className="w-full rounded-control border border-hairline bg-canvas px-2 py-1.5 text-xs"><option value="">未分類</option>{groups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></td><td className="px-3 py-3 font-medium tabular-nums">{tag.friendCount ?? 0}人</td><td className="truncate px-3 py-3 text-xs text-ink-secondary" title={linked ? 'LINE Login・回答フォーム' : '手動'}>{linked ? 'LINE Login' : '手動'}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-1">{linked ? <><span className="rounded-pill bg-accent-soft px-2 py-1 text-[10px] text-accent">本人+{tag.mileageReward ?? 0}</span>{tag.mileageMultiplierBps && <span className="rounded-pill bg-warning-bg px-2 py-1 text-[10px] text-warning">{tag.mileageMultiplierBps / 10000}倍</span>}</> : <span className="text-xs text-ink-faint">—</span>}</div></td><td className="truncate px-3 py-3 text-xs text-ink-secondary">配信・フォーム</td><td className="px-3 py-3 text-xs text-ink-faint">{new Date(tag.createdAt).toLocaleDateString('ja-JP')}</td><td className="px-2 py-3"><div className="flex gap-2 text-xs"><Link href={`/tags/edit?id=${tag.id}`} className="text-action hover:underline">編集</Link><button type="button" onClick={() => setDeleteTarget(tag)} className="text-danger hover:underline">削除</button></div></td></tr> })}</tbody></table>
              <div className="flex items-center justify-end gap-1 border-t border-hairline px-4 py-3"><button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => value - 1)} className="rounded-control border border-hairline px-3 py-1.5 text-xs disabled:opacity-40">前へ</button><span className="rounded-control bg-accent px-3 py-1.5 text-xs font-bold text-on-accent">{currentPage}</span><span className="px-2 text-xs text-ink-faint">/ {pages}</span><button type="button" disabled={currentPage === pages} onClick={() => setPage((value) => value + 1)} className="rounded-control border border-hairline px-3 py-1.5 text-xs disabled:opacity-40">次へ</button></div>
            </div>
          </main>
        </div>
      </> : tab === 'fields' ? <FriendFieldList /> : tab === 'marks' ? <SupportMarkList /> : <SavedSearchList />}
      {deleteTarget && <DeleteTagDialog tag={deleteTarget} onCancel={() => setDeleteTarget(null)} onDeleted={() => { setDeleteTarget(null); void load() }} />}
    </div>
  )
}
