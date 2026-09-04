'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Tag, TagGroup } from '@line-crm/shared'
import { api, type ListStats } from '@/lib/api'
import Pagination from '@/components/shared/pagination'

const UNGROUPED = '__ungrouped__'
const SHADOW = '[box-shadow:1px_1px_1px_rgba(29,29,31,0.13)]'
type Quick = '' | 'unused' | 'recent' | 'automatic' | 'linked' | 'starred'
type Meta = { source: string; usage: string; date: string; chips: string[] }

export interface FriendAttributesV2Fixture {
  items: Tag[]
  groups: TagGroup[]
  stats: ListStats['tags']
  total: number
  pageCount?: number
  folderCounts: Record<string, number>
  meta: Record<string, Meta>
}

const QA_GROUPS: TagGroup[] = [
  ['VIP', '#F59E0B'], ['ペット', '#EC4899'], ['会員', '#10B981'],
  ['健康', '#06B6D4'], ['購入', '#3B82F6'],
].map(([name, color], index) => ({ id: `qa-group-${index}`, name, color, sortOrder: index, createdAt: '', updatedAt: '' }))

export const FRIEND_ATTRIBUTES_V2_QA_FIXTURE: FriendAttributesV2Fixture = {
  groups: QA_GROUPS,
  items: [
    ['EC顧客連携済み', 4, 5, 10, 0, 12000, true],
    ['LINEログイン連携済み', 2, 5, 0, 0, null, true],
    ['NEN会員', 2, 5, 10, 5, 15000, false],
    ['商品到着確認対象', 4, 3, 3, 0, null, false],
    ['未契約', -1, 3, 0, 0, null, true],
    ['誕生日クーポン対象', 0, 0, 20, 0, null, false],
  ].map(([name, groupIndex, friendCount, reward, referral, multiplier, starred], index) => ({
    id: `qa-tag-${index}`, name: String(name), color: '#8B938D',
    groupId: Number(groupIndex) >= 0 ? QA_GROUPS[Number(groupIndex)].id : null,
    friendCount: Number(friendCount), mileageReward: Number(reward), referralMileageReward: Number(referral),
    mileageMultiplierBps: multiplier == null ? null : Number(multiplier), mileageMultiplierPriority: 0,
    isStarred: Boolean(starred), displayOrder: index, createdAt: `2026-01-${String(11 + index).padStart(2, '0')}T00:00:00.000Z`,
  })),
  stats: { total: 101, unused: 78, taggedFriends: 5, assignedThisMonth: 78 },
  total: 101,
  pageCount: 12,
  folderCounts: { all: 101, 'qa-group-0': 8, 'qa-group-1': 6, 'qa-group-2': 8, 'qa-group-3': 8, 'qa-group-4': 9, [UNGROUPED]: 11 },
  meta: {
    'qa-tag-0': { source: 'EC連携', usage: '配信3・フォーム1', date: '2026/01/11', chips: ['本人+10', '1.2倍', '他1'] },
    'qa-tag-1': { source: 'LINE Login', usage: 'シナリオ2', date: '2026/01/13', chips: [] },
    'qa-tag-2': { source: '回答フォーム', usage: '配信4', date: '2026/01/13', chips: ['本人+10', '紹介+5', '1.5倍', '他3'] },
    'qa-tag-3': { source: 'EC購入', usage: '自動応答1', date: '2026/01/13', chips: ['本人+3', '他1'] },
    'qa-tag-4': { source: '手動', usage: '保存検索2', date: '2026/01/13', chips: [] },
    'qa-tag-5': { source: '誕生日ルール', usage: '配信1', date: '2026/01/13', chips: ['本人+20', '他2'] },
  },
}

function metaFor(tag: Tag): Meta {
  const chips: string[] = []
  if ((tag.mileageReward ?? 0) > 0) chips.push(`本人+${tag.mileageReward}`)
  if ((tag.referralMileageReward ?? 0) > 0) chips.push(`紹介+${tag.referralMileageReward}`)
  if (tag.mileageMultiplierBps) chips.push(`${tag.mileageMultiplierBps / 10000}倍`)
  return { source: chips.length ? '連動設定' : '手動', usage: '—', date: new Date(tag.createdAt).toLocaleDateString('ja-JP'), chips }
}

/** ダブルクォートを含む一般的なCSVの1行を読む。1列目=タグ名、2列目=フォルダ名。 */
function parseCsvLine(line: string): string[] {
  const cells: string[] = []; let cell = ''; let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"' && quoted && line[index + 1] === '"') { cell += '"'; index += 1 }
    else if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) { cells.push(cell.trim()); cell = '' }
    else cell += char
  }
  cells.push(cell.trim()); return cells
}

function Pager({ page, pages, onChange }: { page: number; pages: number; onChange: (page: number) => void }) {
  return <div data-design="Pagination" className="mt-4 flex justify-end">
    <Pagination page={page} pageCount={pages} onPageChange={onChange} ariaLabel="ページ送り（前へ・次へ）" />
  </div>
}

export default function FriendAttributesV2TagList({ fixture }: { fixture?: FriendAttributesV2Fixture }) {
  const [items, setItems] = useState<Tag[]>(fixture?.items ?? [])
  const [groups, setGroups] = useState<TagGroup[]>(fixture?.groups ?? [])
  const [stats, setStats] = useState<ListStats['tags'] | null>(fixture?.stats ?? null)
  const [loading, setLoading] = useState(!fixture)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [folder, setFolder] = useState('')
  const [usage, setUsage] = useState('all')
  const [source, setSource] = useState('all')
  const [quick, setQuick] = useState<Quick>(fixture ? 'unused' : '')
  const [quickTouched, setQuickTouched] = useState(false)
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [dragId, setDragId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [csvOpen, setCsvOpen] = useState(false)
  const [csvRows, setCsvRows] = useState<Array<{ name: string; folder: string }>>([])
  const [csvSaving, setCsvSaving] = useState(false)
  const [csvError, setCsvError] = useState('')

  const load = useCallback(async () => {
    if (fixture) return
    setLoading(true); setError('')
    try {
      const [tags, folders, listStats] = await Promise.all([api.tags.list({ withCounts: true }), api.tagGroups.list(), api.listStats.get()])
      if (!tags.success) throw new Error(tags.error)
      if (!folders.success) throw new Error(folders.error)
      setItems(tags.data); setGroups(folders.data)
      if (listStats.success) setStats(listStats.data.tags)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'タグを読み込めませんでした') }
    finally { setLoading(false) }
  }, [fixture])
  useEffect(() => { void load() }, [load])

  const getMeta = useCallback((tag: Tag) => fixture?.meta[tag.id] ?? metaFor(tag), [fixture])
  const filtered = useMemo(() => items.filter((tag) => {
    const meta = getMeta(tag)
    if (query && !`${tag.name} ${meta.source} ${meta.usage}`.toLowerCase().includes(query.toLowerCase())) return false
    if (folder === UNGROUPED && tag.groupId) return false
    if (folder && folder !== UNGROUPED && tag.groupId !== folder) return false
    if (usage === 'unused' && (tag.friendCount ?? 0) > 0) return false
    if (usage === 'linked' && meta.chips.length === 0) return false
    if (source !== 'all' && meta.source !== source) return false
    if ((!fixture || quickTouched) && quick === 'unused' && (tag.friendCount ?? 0) > 0) return false
    if (quick === 'linked' && meta.chips.length === 0) return false
    if (quick === 'starred' && !tag.isStarred) return false
    if (quick === 'automatic' && meta.source === '手動') return false
    if (quick === 'recent') {
      const monthAgo = new Date(); monthAgo.setMonth(monthAgo.getMonth() - 1)
      if (new Date(tag.createdAt) < monthAgo) return false
    }
    return true
  }), [items, getMeta, query, folder, usage, source, quick, quickTouched, fixture])
  useEffect(() => setPage(1), [query, folder, usage, source, quick, pageSize])

  const total = fixture?.total ?? filtered.length
  const pages = fixture?.pageCount ?? Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, pages)
  const visible = fixture ? filtered : filtered.slice((current - 1) * pageSize, current * pageSize)
  const folderRows = [
    { id: '', name: 'すべて', color: '#06C755', count: fixture?.folderCounts.all ?? items.length },
    ...groups.map((group) => ({ id: group.id, name: group.name, color: group.color ?? '#8B938D', count: fixture?.folderCounts[group.id] ?? items.filter((tag) => tag.groupId === group.id).length })),
    { id: UNGROUPED, name: '未分類', color: '#B8BDB9', count: fixture?.folderCounts[UNGROUPED] ?? items.filter((tag) => !tag.groupId).length },
  ]
  const duplicateCount = useMemo(() => { const names = new Map<string, number>(); items.forEach((tag) => names.set(tag.name, (names.get(tag.name) ?? 0) + 1)); return [...names.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0) }, [items])
  const kpis = [
    ['タグ数', stats?.total ?? items.length, '件', `未使用 ${stats?.unused ?? 0}件`],
    ['付与済み友だち', stats?.taggedFriends ?? 0, '人', '1つ以上付与'],
    ['今月の付与', stats?.assignedThisMonth ?? 0, '回', '手動・自動'],
    ['整理候補', fixture ? 80 : (stats?.unused ?? 0) + duplicateCount, '件', '未使用・重複名'],
  ] as const

  const reorder = async (targetId: string) => {
    if (!dragId || dragId === targetId || fixture) return setDragId(null)
    const order = items.map((tag) => tag.id); const from = order.indexOf(dragId); const to = order.indexOf(targetId); setDragId(null)
    if (from < 0 || to < 0) return
    order.splice(to, 0, ...order.splice(from, 1)); const rank = new Map(order.map((id, index) => [id, index]))
    setItems((currentItems) => [...currentItems].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999)))
    const result = await api.tags.reorder(order); if (!result.success) { setError(result.error); void load() }
  }

  return <div data-design-node="xn98K" className="min-w-0 text-ink [font-family:'SF_Pro_Text',-apple-system,BlinkMacSystemFont,'Helvetica_Neue',Arial,sans-serif]">
    <header data-design="Head" className="flex min-h-[58px] items-start justify-between gap-5"><div><h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em]">友だち属性</h1><p className="mt-1 text-[13px] text-ink-secondary">タグ・情報欄・対応マーク・保存条件を、用途まで見ながら管理します。</p></div><div className="mt-[11px] flex shrink-0 gap-2"><button type="button" onClick={() => setManualOpen(true)} className="h-9 w-[92px] rounded-control border border-hairline bg-canvas text-[13px]">マニュアル</button><button type="button" onClick={() => { setCsvOpen(true); setCsvRows([]); setCsvError('') }} className="h-9 w-[116px] rounded-control border border-hairline bg-canvas text-[13px]">CSVで一括登録</button></div></header>
    <nav data-design="Tabs" className="mt-4 flex h-7 items-center gap-2" aria-label="友だち属性の種類"><span className="inline-flex h-7 items-center rounded-pill bg-accent-soft px-2 text-[13px] font-semibold text-accent">タグ</span>{[['fields','友だち情報欄'],['marks','対応マーク'],['searches','保存した検索']].map(([tab,label]) => <Link key={tab} href={`/tags?tab=${tab}`} className="inline-flex h-7 items-center rounded-pill bg-canvas-sunken px-2 text-[13px] text-ink-secondary">{label}</Link>)}</nav>
    <section data-design="KPIs" className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">{kpis.map(([title,value,unit,detail]) => <article key={title} className={`h-[108px] rounded-[12px] border border-hairline bg-canvas px-[14px] py-4 ${SHADOW}`}><p className="text-[12px] font-medium text-ink-secondary">{title}</p><p className="mt-1 flex items-baseline gap-1"><span className="text-[26px] font-bold tabular-nums">{value.toLocaleString('ja-JP')}</span><span className="text-[12px] text-ink-secondary">{unit}</span></p><p className="mt-1 text-[11px] text-ink-faint">{detail}</p></article>)}</section>
    <div data-design="Actions" className="mt-4 flex gap-2"><Link href="/tags/folders/new" className="inline-flex h-9 w-[118px] items-center justify-center rounded-control border border-hairline bg-canvas text-[13px]">フォルダを追加</Link><Link href="/tags/new" className="inline-flex h-9 w-[106px] items-center justify-center rounded-control bg-accent-deep text-[13px] font-semibold text-on-accent">＋ タグを追加</Link></div>
    {error && <p className="mt-3 rounded-control border border-danger/20 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p>}
    <div className="mt-4 grid min-w-0 gap-[13px] xl:grid-cols-[270px_minmax(0,1fr)]">
      <aside data-design="Folder" className={`h-fit overflow-hidden rounded-[12px] border border-hairline bg-canvas ${SHADOW}`}><div className="flex h-[42px] items-center justify-between border-b border-hairline px-4"><h2 className="text-[13px] font-bold">フォルダ</h2><span className="text-[11px] text-ink-faint">{fixture?.total ?? items.length}件</span></div><div className="px-2">{folderRows.map((row) => <button key={row.id} type="button" onClick={() => setFolder(row.id)} className={`flex h-[41px] w-full items-center gap-2 rounded-control px-3 text-[13px] ${folder === row.id ? 'bg-accent-soft font-semibold text-accent' : 'text-ink-secondary hover:bg-canvas-sunken'}`}><span className="h-2 w-2 rounded-full" style={{backgroundColor:row.color}} /><span className="flex-1 truncate text-left">{row.name}</span><span className={`inline-flex min-w-7 justify-center rounded-full px-2 py-1 text-[11px] ${folder === row.id ? 'bg-canvas text-accent' : 'bg-canvas-sunken text-ink-faint'}`}>{row.count}</span></button>)}</div><p className="min-h-[46px] border-t border-hairline px-4 py-[10px] text-[10px] leading-4 text-ink-faint">フォルダを削除しても、中のタグは未分類として残ります。</p></aside>
      <main className="min-w-0"><div data-design="Toolbar" className="flex min-h-[38px] flex-wrap items-center gap-2"><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="タグ名・用途で検索" className="h-[38px] w-[145px] rounded-[9px] border border-hairline bg-canvas px-3 text-[12px] font-medium outline-none placeholder:text-ink focus:border-accent" /><select value={usage} onChange={(e) => setUsage(e.target.value)} className="h-[38px] appearance-none rounded-[9px] border border-hairline bg-canvas px-3 text-[12px] font-medium"><option value="all">使用状態：すべて</option><option value="unused">未使用</option><option value="linked">連動あり</option></select><select value={source} onChange={(e) => setSource(e.target.value)} className="h-[38px] appearance-none rounded-[9px] border border-hairline bg-canvas px-3 text-[12px] font-medium"><option value="all">付与元：すべて</option>{[...new Set(items.map((tag) => getMeta(tag).source))].map((value) => <option key={value}>{value}</option>)}</select><select aria-label="表示件数" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="ml-auto h-[38px] appearance-none rounded-[9px] border border-hairline bg-canvas px-3 text-[12px] font-medium">{[20,30,40,50].map((size) => <option key={size} value={size}>{size}件表示</option>)}</select><span className="whitespace-nowrap text-[11px] text-ink-faint">{total ? (current-1)*pageSize+1 : 0}〜{Math.min(current*pageSize,total)}/{total}件</span></div>
        <div data-design="QuickFilters" className="mb-1 mt-[10px] flex min-h-7 flex-wrap items-center gap-2 text-[11px]"><span className="text-ink-faint">よく使う</span>{([['unused','未使用のタグ'],['recent','今月増えたタグ'],['automatic','自動付与あり'],['linked','連動あり'],['starred','★一覧表示']] as Array<[Quick,string]>).map(([key,label]) => <button key={key} type="button" onClick={() => {setQuickTouched(true);setQuick(quick===key?'':key)}} className={`rounded-pill border px-3 py-1.5 ${quick===key?'border-accent bg-accent-soft text-accent':'border-hairline bg-canvas text-ink-secondary'}`}>{label}</button>)}</div>
        <div data-design="Table" className={`border-t border-hairline bg-canvas ${SHADOW}`}><table className="w-full table-fixed text-[13px]"><colgroup><col className="w-9 2xl:w-[41px]"/><col className="w-[20%] 2xl:w-[240px]"/><col className="w-[11%] 2xl:w-[119px]"/><col className="w-[8%] 2xl:w-[77px]"/><col className="w-[11%] 2xl:w-[118px]"/><col className="w-[21%] 2xl:w-[251px]"/><col className="hidden w-[11%] 2xl:table-column 2xl:w-[130px]"/><col className="hidden w-[9%] 2xl:table-column 2xl:w-[101px]"/><col className="hidden w-[7%] 2xl:table-column 2xl:w-[67px]"/><col className="w-[12%] 2xl:w-[145px]"/></colgroup><thead className="h-[46px] border-b border-hairline bg-canvas-sunken text-[11px] text-ink-faint"><tr><th/><th className="px-2 text-left">タグ</th><th className="px-2 text-left">フォルダ</th><th className="px-2 text-left">付与人数</th><th className="px-2 text-left">自動付与のもと</th><th className="px-2 text-left">連動（マイル・アクション）</th><th className="hidden px-2 text-left 2xl:table-cell">使用先</th><th className="hidden px-2 text-left 2xl:table-cell">登録日</th><th className="hidden px-2 text-left 2xl:table-cell">表示</th><th className="px-2 text-left">操作</th></tr></thead><tbody className="divide-y divide-hairline">{loading ? <tr><td colSpan={10} className="h-[184px] text-center text-ink-faint">読み込み中…</td></tr> : visible.length===0 ? <tr><td colSpan={10} className="h-[184px] text-center text-ink-faint">条件に合うタグはありません</td></tr> : visible.map((tag) => {const meta=getMeta(tag);return <tr key={tag.id} className="h-[46px] hover:bg-canvas-sunken"><td draggable={!fixture} onDragStart={()=>setDragId(tag.id)} onDragOver={(e)=>!fixture&&e.preventDefault()} onDrop={()=>void reorder(tag.id)} className="cursor-grab px-2 text-center text-ink-faint"><span className="text-[14px] tracking-[-2px]">⠿</span></td><td className="truncate px-2 font-medium" title={tag.name}>{tag.name}</td><td className="px-2"><div className="inline-flex h-7 w-[76px] items-center gap-1.5 rounded-[8px] border border-hairline bg-canvas px-2"><span className="h-2 w-2 shrink-0 rounded-full" style={{backgroundColor:groups.find((group)=>group.id===tag.groupId)?.color??'#9ca3af'}}/><select aria-label={`${tag.name}のフォルダ`} value={tag.groupId??''} disabled={Boolean(fixture)} onChange={async(e)=>{const result=await api.tags.setGroup(tag.id,e.target.value||null);if(!result.success)setError(result.error);else void load()}} className="min-w-0 flex-1 appearance-none bg-transparent text-[11px] font-medium outline-none disabled:opacity-100"><option value="">未分類</option>{groups.map((group)=><option key={group.id} value={group.id}>{group.name}</option>)}</select></div></td><td className="px-2 font-medium">{tag.friendCount??0}人</td><td className="truncate px-2 text-[12px] text-ink-secondary">{meta.source}</td><td className="px-2"><div className="flex gap-1 overflow-hidden">{meta.chips.length?meta.chips.map((chip,index)=><span key={chip} className={`whitespace-nowrap rounded-pill px-2 py-1 text-[10px] ${chip.includes('倍')?'bg-warning-bg text-warning':index>1?'bg-canvas-sunken text-ink-secondary':'bg-accent-soft text-accent'}`}>{chip}</span>):<span className="text-ink-faint">—</span>}</div></td><td className="hidden truncate px-2 text-[12px] text-ink-secondary 2xl:table-cell">{meta.usage}</td><td className="hidden px-2 text-[11px] text-ink-faint 2xl:table-cell">{meta.date}</td><td className="hidden px-2 text-[11px] 2xl:table-cell"><button type="button" disabled={Boolean(fixture)} onClick={async()=>{const result=await api.tags.update(tag.id,{isStarred:!tag.isStarred});if(!result.success)setError(result.error);else void load()}}>{tag.isStarred?'★ 一覧':'—'}</button></td><td className="px-2"><div className="flex gap-3 whitespace-nowrap text-[12px]"><Link href={`/tags/edit?id=${encodeURIComponent(tag.id)}`} className="font-medium text-accent">編集</Link><button type="button" onClick={()=>setDeleteTarget(tag)} className="text-danger">削除</button></div></td></tr>})}</tbody></table><Pager page={current} pages={pages} onChange={setPage}/></div>
      </main>
    </div>
    {manualOpen&&<div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/40 p-4"><section role="dialog" aria-modal="true" className={`w-full max-w-[520px] rounded-card border border-hairline bg-canvas p-6 ${SHADOW}`}><h2 className="text-lg font-bold">友だち属性V2の使い方</h2><p className="mt-3 text-sm leading-6 text-ink-secondary">検索、絞り込み、フォルダ変更、★表示、並び替えはこの一覧から行えます。作成・編集は移行中のため、現在の安全な登録画面を開きます。</p><div className="mt-6 flex justify-end"><button type="button" onClick={()=>setManualOpen(false)} className="rounded-control bg-accent-deep px-4 py-2 text-sm font-semibold text-on-accent">閉じる</button></div></section></div>}
    {csvOpen&&<div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/40 p-4"><section role="dialog" aria-modal="true" aria-labelledby="csv-import-title" className={`w-full max-w-[560px] rounded-card border border-hairline bg-canvas p-6 ${SHADOW}`}><h2 id="csv-import-title" className="text-lg font-bold">CSVでタグを一括登録</h2><p className="mt-2 text-sm leading-6 text-ink-secondary">1列目にタグ名、2列目にフォルダ名を入れます。先頭行が「タグ名」の場合は見出しとして除外します。</p><input aria-label="登録するCSV" type="file" accept=".csv,text/csv" onChange={async(event)=>{const file=event.target.files?.[0];if(!file)return;const text=(await file.text()).replace(/^\uFEFF/,'');const parsed=text.split(/\r?\n/).map(parseCsvLine).filter((cells)=>cells[0]?.trim()).map(([name,folder=''])=>({name:name.trim(),folder:folder.trim()}));setCsvRows(parsed[0]?.name==='タグ名'?parsed.slice(1):parsed);setCsvError('')}} className="mt-5 block w-full rounded-control border border-hairline p-3 text-sm"/><p className="mt-3 text-sm text-ink-secondary">登録対象: <strong className="text-ink">{csvRows.length}件</strong></p>{csvError&&<p className="mt-3 rounded-control bg-danger-bg p-3 text-sm text-danger">{csvError}</p>}<div className="mt-6 flex justify-end gap-2"><button type="button" disabled={csvSaving} onClick={()=>setCsvOpen(false)} className="rounded-control border border-hairline px-4 py-2 text-sm">キャンセル</button><button type="button" disabled={csvSaving||csvRows.length===0} onClick={async()=>{setCsvSaving(true);setCsvError('');try{const known=new Set(items.map((tag)=>tag.name));for(const row of csvRows.slice(0,500)){if(known.has(row.name))continue;const group=groups.find((candidate)=>candidate.name===row.folder);const result=await api.tags.create({name:row.name,groupId:group?.id??null});if(!result.success)throw new Error(result.error);known.add(row.name)}setCsvOpen(false);void load()}catch(reason){setCsvError(reason instanceof Error?reason.message:'一括登録できませんでした')}finally{setCsvSaving(false)}}} className="rounded-control bg-accent-deep px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-40">{csvSaving?'登録中…':'一括登録する'}</button></div></section></div>}
    {deleteTarget&&<div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/40 p-4"><section role="alertdialog" aria-modal="true" className={`w-full max-w-[520px] rounded-card border border-hairline bg-canvas p-6 ${SHADOW}`}><h2 className="text-xl font-bold">タグを削除しますか？</h2><p className="mt-3 text-sm leading-6 text-ink-secondary">「{deleteTarget.name}」を削除します。この操作は元に戻せません。</p><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={()=>setDeleteTarget(null)} className="rounded-control border border-hairline px-4 py-2 text-sm">キャンセル</button><button type="button" onClick={async()=>{const result=await api.tags.delete(deleteTarget.id);if(!result.success)setError(result.error);else{setDeleteTarget(null);void load()}}} className="rounded-control bg-danger px-4 py-2 text-sm font-bold text-on-accent">削除する</button></div></section></div>}
  </div>
}
