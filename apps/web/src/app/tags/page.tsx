'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Tag, TagGroup } from '@line-crm/shared'
import { api, type ListStats } from '@/lib/api'
import FriendAttributesView, {
  type FriendAttributesFolderView,
  type FriendAttributesLinkView,
  type FriendAttributesRowView,
} from '@/components/friend-attributes-v4/friend-attributes-view'

const UNGROUPED = '__ungrouped__'
type QuickFilter = '' | 'unused' | 'recent' | 'linked' | 'action' | 'starred'

function hasAutomaticRule(tag: Tag): boolean {
  return Boolean(tag.mileageReward || tag.referralMileageReward || tag.mileageMultiplierBps)
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"' && quoted && line[index + 1] === '"') { cell += '"'; index += 1 }
    else if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) { cells.push(cell.trim()); cell = '' }
    else cell += char
  }
  cells.push(cell.trim())
  return cells
}

function linksFor(tag: Tag): FriendAttributesLinkView[] {
  const links: FriendAttributesLinkView[] = []
  if ((tag.mileageReward ?? 0) > 0) links.push({ label: `本人+${tag.mileageReward}`, tone: 'green' })
  if ((tag.referralMileageReward ?? 0) > 0) links.push({ label: `紹介+${tag.referralMileageReward}`, tone: 'green' })
  if (tag.mileageMultiplierBps) links.push({ label: `${tag.mileageMultiplierBps / 10000}倍`, tone: 'orange' })
  return links
}

export default function TagsPage() {
  const [items, setItems] = useState<Tag[]>([])
  const [groups, setGroups] = useState<TagGroup[]>([])
  const [stats, setStats] = useState<ListStats['tags'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [folder, setFolder] = useState('')
  const [usageFilter, setUsageFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [dragId, setDragId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [tagsResult, groupsResult, statsResult] = await Promise.all([
        api.tags.list({ withCounts: true }),
        api.tagGroups.list(),
        api.listStats.get().catch(() => null),
      ])
      if (!tagsResult.success) throw new Error(tagsResult.error)
      if (!groupsResult.success) throw new Error(groupsResult.error)
      setItems(tagsResult.data)
      setGroups(groupsResult.data)
      if (statsResult?.success) setStats(statsResult.data.tags)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => items.filter((tag) => {
    const automatic = hasAutomaticRule(tag)
    if (query && !tag.name.toLowerCase().includes(query.trim().toLowerCase())) return false
    if (folder === UNGROUPED && tag.groupId) return false
    if (folder && folder !== UNGROUPED && tag.groupId !== folder) return false
    if (usageFilter === 'unused' && (tag.friendCount ?? 0) > 0) return false
    if (usageFilter === 'linked' && !automatic) return false
    if (sourceFilter === 'manual' && automatic) return false
    if (sourceFilter === 'automatic' && !automatic) return false
    if (quickFilter === 'unused' && (tag.friendCount ?? 0) > 0) return false
    if ((quickFilter === 'linked' || quickFilter === 'action') && !automatic) return false
    if (quickFilter === 'starred' && !tag.isStarred) return false
    if (quickFilter === 'recent') {
      const created = new Date(tag.createdAt)
      const now = new Date()
      if (created.getFullYear() !== now.getFullYear() || created.getMonth() !== now.getMonth()) return false
    }
    return true
  }), [items, query, folder, usageFilter, sourceFilter, quickFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const rangeStart = filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const rangeEnd = Math.min(currentPage * pageSize, filtered.length)

  useEffect(() => setPage(1), [query, folder, usageFilter, sourceFilter, quickFilter, pageSize])

  const folderViews = useMemo<FriendAttributesFolderView[]>(() => [
    { id: '', name: 'すべて', count: items.length, color: '#18ae72' },
    ...groups.map((group) => ({
      id: group.id,
      name: group.name,
      count: items.filter((tag) => tag.groupId === group.id).length,
      color: group.color ?? '#a2a8ad',
    })),
    { id: UNGROUPED, name: '未分類', count: items.filter((tag) => !tag.groupId).length, color: '#a2a8ad' },
  ], [groups, items])

  const rowViews = useMemo<FriendAttributesRowView[]>(() => visible.map((tag) => {
    const group = groups.find((candidate) => candidate.id === tag.groupId)
    const automatic = hasAutomaticRule(tag)
    return {
      id: tag.id,
      tag: tag.name,
      folderId: tag.groupId ?? '',
      folder: group?.name ?? '未分類',
      folderColor: group?.color ?? '#a2a8ad',
      count: `${tag.friendCount ?? 0}人`,
      source: automatic ? '連動設定' : '手動',
      links: linksFor(tag),
      usage: automatic ? '配信・フォーム' : '—',
      date: formatDate(tag.createdAt),
      starred: Boolean(tag.isStarred),
      editHref: `/tags/edit?id=${encodeURIComponent(tag.id)}`,
    }
  }), [groups, visible])

  const kpis = useMemo(() => {
    const fallback = {
      total: items.length,
      unused: items.filter((tag) => (tag.friendCount ?? 0) === 0).length,
      taggedFriends: items.reduce((sum, tag) => sum + (tag.friendCount ?? 0), 0),
      assignedThisMonth: items.reduce((sum, tag) => sum + (tag.friendCount ?? 0), 0),
    }
    const value = stats ?? fallback
    return [
      { label: 'タグ数', value: `${value.total}件`, note: `未使用 ${value.unused}件` },
      { label: '付与済み友だち', value: `${value.taggedFriends}人`, note: '1つ以上付与' },
      { label: '今月の付与', value: `${value.assignedThisMonth}回`, note: '手動・自動' },
      { label: '整理候補', value: `${value.unused}件`, note: '未使用・確認待ち' },
    ]
  }, [items, stats])

  const setGroup = async (tagId: string, groupId: string) => {
    const result = await api.tags.setGroup(tagId, groupId || null)
    if (!result.success) setError(result.error)
    else setItems((current) => current.map((tag) => tag.id === tagId ? { ...tag, groupId: groupId || null } : tag))
  }

  const toggleStar = async (tagId: string) => {
    const target = items.find((tag) => tag.id === tagId)
    if (!target) return
    const next = !target.isStarred
    setItems((current) => current.map((tag) => tag.id === tagId ? { ...tag, isStarred: next } : tag))
    const result = await api.tags.update(tagId, { isStarred: next })
    if (!result.success) { setError(result.error); void load() }
  }

  const reorder = async (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); return }
    const order = filtered.map((tag) => tag.id)
    const from = order.indexOf(dragId)
    const to = order.indexOf(targetId)
    setDragId(null)
    if (from < 0 || to < 0) return
    order.splice(to, 0, ...order.splice(from, 1))
    const rank = new Map(order.map((id, index) => [id, index]))
    setItems((current) => [...current].sort((left, right) => (rank.get(left.id) ?? 99999) - (rank.get(right.id) ?? 99999)))
    const result = await api.tags.reorder(order)
    if (!result.success) { setError(result.error); void load() }
  }

  const importCsv = async (file: File) => {
    setError('')
    try {
      const text = (await file.text()).replace(/^\uFEFF/, '')
      const parsed = text.split(/\r?\n/).map(parseCsvLine).filter((cells) => cells[0]?.trim())
      const rows = parsed[0]?.[0] === 'タグ名' ? parsed.slice(1) : parsed
      const known = new Set(items.map((tag) => tag.name))
      for (const [rawName, rawFolder = ''] of rows.slice(0, 500)) {
        const name = rawName.trim()
        if (!name || known.has(name)) continue
        const group = groups.find((candidate) => candidate.name === rawFolder.trim())
        const result = await api.tags.create({ name, groupId: group?.id ?? null })
        if (!result.success) throw new Error(result.error)
        known.add(name)
      }
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'CSVを登録できませんでした')
    }
  }

  const requestDelete = (tagId: string) => {
    setDeleteTarget(items.find((tag) => tag.id === tagId) ?? null)
    setDeleteConfirmation('')
  }

  const confirmDelete = async () => {
    if (!deleteTarget || deleteConfirmation !== deleteTarget.name || deleteBusy) return
    setDeleteBusy(true)
    const result = await api.tags.delete(deleteTarget.id)
    setDeleteBusy(false)
    if (!result.success) { setError(result.error); return }
    setDeleteTarget(null)
    setDeleteConfirmation('')
    await load()
  }

  return <FriendAttributesView kpis={kpis} folders={folderViews} rows={rowViews} totalCount={items.length} filteredCount={filtered.length} rangeStart={rangeStart} rangeEnd={rangeEnd} activeFolderId={folder} query={query} usageFilter={usageFilter} sourceFilter={sourceFilter} quickFilter={quickFilter} pageSize={pageSize} currentPage={currentPage} totalPages={totalPages} loading={loading} error={error} deletingTag={deleteTarget?.name} deleteConfirmation={deleteConfirmation} deleteBusy={deleteBusy} onFolderSelect={setFolder} onQueryChange={setQuery} onUsageFilterChange={setUsageFilter} onSourceFilterChange={setSourceFilter} onQuickFilterChange={(value) => setQuickFilter(value as QuickFilter)} onPageSizeChange={setPageSize} onPageChange={setPage} onCsvFile={(file) => void importCsv(file)} onGroupChange={(tagId, groupId) => void setGroup(tagId, groupId)} onToggleStar={(tagId) => void toggleStar(tagId)} onDeleteRequest={requestDelete} onDeleteCancel={() => setDeleteTarget(null)} onDeleteConfirmationChange={setDeleteConfirmation} onDeleteConfirm={() => void confirmDelete()} onDragStart={setDragId} onDrop={(tagId) => void reorder(tagId)} />
}
