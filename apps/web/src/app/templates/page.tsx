'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { api, type BroadcastAssetKind, type TemplateQuestion } from '@/lib/api'
import FlexPreviewComponent from '@/components/flex-preview'
import ImageUploader from '@/components/shared/image-uploader'
import BroadcastAssetManager from '@/components/broadcasts/broadcast-asset-manager'
import { TableHeadRow, Th } from '@/components/shared/table'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import FolderPanel from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import FolderEditDialog from '@/components/shared/folder-edit-dialog'
import ListState from '@/components/shared/list-state'
import { Tabs } from '@/components/shared/tabs'
import styles from './templates-v6.module.css'
import { useAccount } from '@/contexts/account-context'
import type { Folder } from '@line-crm/shared'

interface Template {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
  folderId: string | null
  isFavorite: boolean
  question: TemplateQuestion | null
  questionStatus: 'draft' | 'published'
  usageCount: number
  /** 162: 選択肢が押された回数の合計。押される仕掛けが無いものは 0。 */
  tapCount: number
  createdAt: string
  updatedAt: string
}

interface TemplateDetail {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
  folderId: string | null
  isFavorite: boolean
  question: TemplateQuestion | null
  questionStatus: 'draft' | 'published'
  usedBy: {
    autoReplies: Array<{ id: string; keyword: string; matchType: 'exact' | 'contains'; lineAccountId: string | null }>
    automations: Array<{ id: string; name: string; eventType: string }>
    scenarioSteps: Array<{ scenarioId: string; scenarioName: string; stepId: string; stepOrder: number }>
    reminderSteps: Array<{ reminderId: string; reminderName: string; stepId: string }>
    richMenuAreas: Array<{ groupId: string; groupName: string; pageName: string; areaId: string; label: string | null }>
    trackedLinks: Array<{ id: string; name: string }>
  }
  createdAt: string
  updatedAt: string
}

type TypeFilter = 'all' | 'text' | 'flex' | 'image' | 'question' | 'unused'

const ASSET_KINDS: readonly BroadcastAssetKind[] = [
  'card_message',
  'rich_message',
  'coupon',
  'research',
]

const messageTypeLabels: Record<string, string> = {
  text: 'テキスト',
  image: '画像',
  flex: 'Flex',
  carousel: 'Carousel',
  question: '質問',
}

const typeBadgeColor: Record<string, string> = {
  text: 'bg-canvas-sunken text-ink-secondary',
  flex: 'bg-purple-100 text-purple-700',
  image: 'bg-info-bg text-info',
  carousel: 'bg-amber-100 text-amber-700',
  question: 'bg-accent-soft text-accent-deep',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function TemplatesPage() {
  const { selectedAccountId, accounts, loading: accountLoading } = useAccount()
  const activeAccountRef = useRef<string | null>(selectedAccountId)
  const [activeSection, setActiveSection] = useState<'message' | BroadcastAssetKind>('message')
  const [templates, setTemplates] = useState<Template[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [assetCounts, setAssetCounts] = useState<Partial<Record<BroadcastAssetKind, number>>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [folderLoadStatus, setFolderLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [showCreate, setShowCreate] = useState(false)
  // 名前の絞り込み（設計 `Body` の「テンプレート名で検索」）。
  const [nameQuery, setNameQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [selectedFolderId, setSelectedFolderId] = useState('all')
  const [showFolderAdd, setShowFolderAdd] = useState(false)
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)
  const [pendingFolderDelete, setPendingFolderDelete] = useState<Folder | null>(null)
  const [folderActionBusy, setFolderActionBusy] = useState(false)
  const [folderActionError, setFolderActionError] = useState('')
  const [form, setForm] = useState({
    name: '',
    category: 'general',
    messageType: 'text',
    messageContent: '',
    folderId: null as string | null,
  })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // Drawer
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [drawerData, setDrawerData] = useState<TemplateDetail | null>(null)
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [drawerError, setDrawerError] = useState<string | null>(null)
  const [editContent, setEditContent] = useState<string | null>(null)
  const [editName, setEditName] = useState<string | null>(null)
  const [editFolderId, setEditFolderId] = useState<string | null | undefined>(undefined)
  const [savingEdit, setSavingEdit] = useState(false)

  useEffect(() => {
    activeAccountRef.current = selectedAccountId
    setDrawerId(null)
    setShowCreate(false)
    setPendingDelete(null)
    setDeleteError('')
    setSelectedFolderId('all')
    setShowFolderAdd(false)
    setEditingFolder(null)
    setPendingFolderDelete(null)
    setFolderActionError('')
  }, [selectedAccountId])

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setTemplates([])
      setFolders([])
      setLoadError('')
      setFolderLoadStatus('ready')
      setLoading(false)
      return
    }
    const accountId = selectedAccountId
    setLoading(true)
    setTemplates([])
    setFolders([])
    setLoadError('')
    setFolderLoadStatus('loading')
    const [templateOutcome, folderOutcome] = await Promise.allSettled([
        api.templates.list(undefined, accountId),
        api.folders.list('template', accountId),
      ])
    if (activeAccountRef.current !== accountId) return

    if (templateOutcome.status === 'fulfilled' && templateOutcome.value.success) {
      setTemplates(templateOutcome.value.data)
    } else {
      setLoadError('テンプレートを読み込めませんでした。状態を読み直して、もう一度お試しください。')
    }
    if (folderOutcome.status === 'fulfilled' && folderOutcome.value.success) {
      setFolders(folderOutcome.value.data)
      setFolderLoadStatus('ready')
    } else {
      setFolderLoadStatus('error')
    }
    setLoading(false)
  }, [selectedAccountId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    let cancelled = false
    if (!selectedAccountId) {
      setAssetCounts({})
      return () => { cancelled = true }
    }
    void Promise.all(
      ASSET_KINDS.map(async (kind) => {
        const result = await api.broadcastMessageAssets.list({ kind, accountId: selectedAccountId })
        return [kind, result.success ? result.data.length : undefined] as const
      }),
    ).then((entries) => {
      if (cancelled) return
      setAssetCounts(Object.fromEntries(entries.filter((entry) => entry[1] !== undefined)))
    })
    return () => { cancelled = true }
  }, [selectedAccountId])

  // Drawer fetch
  useEffect(() => {
    if (!drawerId) { setDrawerData(null); setDrawerError(null); return }
    let cancelled = false
    setDrawerLoading(true)
    setDrawerError(null)
    setDrawerData(null)
    api.templates.get(drawerId).then((detailRes) => {
      if (cancelled) return
      if (detailRes.success && detailRes.data) {
        setDrawerData(detailRes.data)
      } else {
        setDrawerError((detailRes as { error?: string }).error ?? '読み込みに失敗しました')
      }
    }).catch((err) => {
      if (cancelled) return
      setDrawerError(err instanceof Error ? err.message : String(err))
    }).finally(() => {
      if (!cancelled) setDrawerLoading(false)
    })
    return () => { cancelled = true }
  }, [drawerId])

  // reset edits when drawer changes
  useEffect(() => {
    setEditContent(null)
    setEditName(null)
    setEditFolderId(undefined)
  }, [drawerId])

  const filteredTemplates = templates.filter((t) => {
    // 名前は手元で絞る。打つたびに取り直すと重い。
    const normalizedQuery = nameQuery.trim().toLowerCase()
    if (normalizedQuery && !`${t.name}\n${t.messageContent}`.toLowerCase().includes(normalizedQuery)) {
      return false
    }
    if (selectedFolderId === 'favorites') {
      if (!t.isFavorite) return false
    } else if (selectedFolderId === 'unfiled') {
      if (t.folderId !== null) return false
    } else if (selectedFolderId !== 'all' && t.folderId !== selectedFolderId) {
      return false
    }
    if (typeFilter === 'all') return true
    if (typeFilter === 'unused') return t.usageCount === 0
    if (typeFilter === 'question') return Boolean(t.question)
    if (typeFilter === 'text') return t.messageType === 'text' && t.question === null
    return t.messageType === typeFilter
  })

  const folderById = new Map(folders.map((folder) => [folder.id, folder]))
  const unfiledCount = templates.filter((template) => template.folderId === null).length
  const favoriteCount = templates.filter((template) => template.isFavorite).length
  const moveFolder = async (folderId: string, direction: -1 | 1) => {
    if (!selectedAccountId || folderActionBusy) return
    const ordered = [...folders].sort((left, right) => (
      left.displayOrder - right.displayOrder || left.name.localeCompare(right.name, 'ja')
    ))
    const from = ordered.findIndex((folder) => folder.id === folderId)
    const to = from + direction
    if (from < 0 || to < 0 || to >= ordered.length) return
    const next = [...ordered]
    ;[next[from], next[to]] = [next[to]!, next[from]!]
    setFolderActionBusy(true)
    setFolderActionError('')
    try {
      const results = await Promise.all(next.map((folder, index) => (
        api.folders.update(folder.id, { displayOrder: index }, selectedAccountId)
      )))
      const failed = results.find((result) => !result.success)
      if (failed && !failed.success) throw new Error(failed.error)
      await load()
    } catch {
      setFolderActionError('フォルダの並び順を更新できませんでした')
      await load()
    } finally {
      setFolderActionBusy(false)
    }
  }

  const confirmFolderDelete = async () => {
    if (!pendingFolderDelete || !selectedAccountId || folderActionBusy) return
    const folder = pendingFolderDelete
    setFolderActionBusy(true)
    setFolderActionError('')
    try {
      const result = await api.folders.delete(folder.id, selectedAccountId)
      if (!result.success) throw new Error(result.error)
      if (selectedFolderId === folder.id) setSelectedFolderId('all')
      setPendingFolderDelete(null)
      await load()
    } catch {
      setFolderActionError('フォルダを削除できませんでした')
    } finally {
      setFolderActionBusy(false)
    }
  }

  const templateCountsAvailable = !loading && !loadError
  const folderRows = [
    {
      id: 'all',
      label: 'すべて',
      count: templateCountsAvailable ? templates.length : '—',
      icon: <span className="bg-accent rounded-pill block h-2 w-2" />,
    },
    { id: 'favorites', label: 'よく使う', count: templateCountsAvailable ? favoriteCount : '—', icon: '☆' },
    { id: 'unfiled', label: '未分類', count: templateCountsAvailable ? unfiledCount : '—' },
    ...(folderLoadStatus === 'ready' ? folders : []).map((folder, index) => ({
      id: folder.id,
      label: folder.name,
      count: templateCountsAvailable
        ? templates.filter((template) => template.folderId === folder.id).length
        : '—',
      color: folder.color,
      onRename: () => setEditingFolder(folder),
      onChangeColor: () => setEditingFolder(folder),
      onMoveUp: index > 0 ? () => void moveFolder(folder.id, -1) : undefined,
      onMoveDown: index < folders.length - 1 ? () => void moveFolder(folder.id, 1) : undefined,
      onDelete: () => {
        setFolderActionError('')
        setPendingFolderDelete(folder)
      },
    })),
  ]

  const handleCreate = async () => {
    if (!selectedAccountId) {
      setFormError('上のバーでLINE公式アカウントを選んでください')
      return
    }
    if (!form.name.trim()) { setFormError('テンプレート名を入力してください'); return }
    if (!form.messageContent.trim()) { setFormError('メッセージ内容を入力してください'); return }
    setSaving(true)
    setFormError('')
    try {
      const res = await api.templates.create({ ...form, accountId: selectedAccountId })
      if (res.success) {
        setShowCreate(false)
        setForm({
          name: '',
          category: 'general',
          messageType: 'text',
          messageContent: '',
          folderId: null,
        })
        load()
      } else {
        setFormError(res.error)
      }
    } catch {
      setFormError('作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!drawerData) return
    if (editContent !== null && !editContent.trim()) {
      setError('内容を空にはできません')
      return
    }
    if (editName !== null && !editName.trim()) {
      setError('名前を空にはできません')
      return
    }
    setSavingEdit(true)
    try {
      const updates: {
        messageContent?: string
        name?: string
        folderId?: string | null
      } = {}
      if (editContent !== null) updates.messageContent = editContent
      if (editName !== null) updates.name = editName
      if (editFolderId !== undefined) updates.folderId = editFolderId
      await api.templates.update(drawerData.id, updates)
      const r = await api.templates.get(drawerData.id)
      if (r.success && r.data) setDrawerData(r.data)
      setEditContent(null)
      setEditName(null)
      setEditFolderId(undefined)
      load()
    } catch {
      setError('更新に失敗しました')
    }
    setSavingEdit(false)
  }

  const handleDelete = (template: Pick<Template, 'id' | 'name' | 'usageCount'>) => {
    const { id, name, usageCount } = template
    if (usageCount > 0) {
      setDrawerId(id)
      setError(`${usageCount}件で使用中です。使用先を差し替えてから削除してください。`)
      return
    }
    setDeleteError('')
    setPendingDelete({ id, name })
  }

  const toggleFavorite = async (template: Template) => {
    const previous = template.isFavorite
    setTemplates((items) => items.map((item) => (
      item.id === template.id ? { ...item, isFavorite: !previous } : item
    )))
    try {
      const result = await api.templates.update(template.id, { isFavorite: !previous })
      if (!result.success) throw new Error(result.error)
    } catch {
      setTemplates((items) => items.map((item) => (
        item.id === template.id ? { ...item, isFavorite: previous } : item
      )))
      setError('「よく使う」を更新できませんでした')
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    const target = pendingDelete
    setDeleting(true)
    setDeleteError('')
    try {
      const result = await api.templates.delete(target.id)
      if (!result.success) {
        setDeleteError(result.error)
        return
      }
      setPendingDelete(null)
      if (drawerId === target.id) setDrawerId(null)
      await load()
    } catch {
      setDeleteError('削除に失敗しました')
    } finally {
      setDeleting(false)
    }
  }

  const scenarioStepUsages = drawerData?.usedBy.scenarioSteps ?? []
  const reminderStepUsages = drawerData?.usedBy.reminderSteps ?? []
  const richMenuAreaUsages = drawerData?.usedBy.richMenuAreas ?? []
  const trackedLinkUsages = drawerData?.usedBy.trackedLinks ?? []
  const drawerUsageCount = drawerData
    ? drawerData.usedBy.autoReplies.length
      + drawerData.usedBy.automations.length
      + scenarioStepUsages.length
      + reminderStepUsages.length
      + richMenuAreaUsages.length
      + trackedLinkUsages.length
    : 0

  return (
    <div>
      <div data-design="TypeTabs" data-design-node="W7LBc kcmGB">
        <Tabs
          items={[
            {
              label: 'メッセージ',
              count: loading ? undefined : templates.length,
              current: activeSection === 'message',
              onClick: () => { setActiveSection('message'); setShowCreate(false) },
            },
            {
              label: 'カルーセル',
              count: assetCounts.card_message,
              current: activeSection === 'card_message',
              onClick: () => { setActiveSection('card_message'); setShowCreate(false) },
            },
            {
              label: 'リッチメッセージ',
              count: assetCounts.rich_message,
              current: activeSection === 'rich_message',
              onClick: () => { setActiveSection('rich_message'); setShowCreate(false) },
            },
            {
              label: 'クーポン',
              count: assetCounts.coupon,
              current: activeSection === 'coupon',
              onClick: () => { setActiveSection('coupon'); setShowCreate(false) },
            },
            {
              label: 'リサーチ',
              count: assetCounts.research,
              current: activeSection === 'research',
              onClick: () => { setActiveSection('research'); setShowCreate(false) },
            },
          ]}
        />
      </div>

      {activeSection === 'message' && (
        <div
          className={`${styles.createActions} flex items-center justify-between`}
          data-design="CreateActions"
          data-design-node="W7LBc FuBeQ"
        >
          <div className="flex items-center gap-2">
            <Button onClick={() => setShowFolderAdd(true)}>
              フォルダを追加
            </Button>
            <Button
              onClick={() => {
                if (!selectedAccountId) {
                  setError('上のバーでLINE公式アカウントを選んでください')
                  return
                }
                setShowCreate(true)
              }}
              variant="primary"
            >
              テンプレートを作る
            </Button>
            <Button
              href="/templates/questions/new"
              variant="secondary"
            >
              質問を作る
            </Button>
          </div>
        </div>
      )}

      {/* 一覧本体（設計 `Body`）。 */}
      <div className={styles.body} data-design="Body">
      {activeSection === 'message' ? <>
      <div className={styles.contentLayout}>
      <div className={styles.folderRail} aria-label="テンプレートのフォルダ">
        <FolderPanel
          rows={folderRows}
          activeId={selectedFolderId}
          onSelect={setSelectedFolderId}
          total={folderLoadStatus === 'ready' ? `${folders.length}件` : '—'}
        >
          {folderLoadStatus === 'loading' ? (
            <ListState
              kind="loading"
              title="フォルダを読み込んでいます"
              description="取得できるまで件数は表示しません。"
            />
          ) : folderLoadStatus === 'error' ? (
            <ListState
              kind="error"
              title="フォルダを表示できませんでした"
              description="テンプレート一覧はそのまま確認できます。"
              action={(
                <Button variant="primary" onClick={() => void load()}>
                  もう一度読み込む
                </Button>
              )}
            />
          ) : selectedAccountId ? (
            <button
              type="button"
              onClick={() => setShowFolderAdd(true)}
              className="text-accent hover:bg-accent-soft rounded-control w-full px-3 py-2 text-left text-sm font-medium"
            >
              ＋ フォルダを追加
            </button>
          ) : null}
        </FolderPanel>
      </div>
      <div className="min-w-0 flex-1">

      <div className="bg-info-bg text-info mb-3 rounded-control px-3 py-2 text-xs">
        フォルダはLINE公式アカウントごとに分かれます。上のタブは種類の絞り込みです。
      </div>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-control border p-4 text-sm">
          {error}
        </div>
      )}

      {/* 検索と並び順（設計 `Body` の上）。 */}
      <div className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3">
        <input
          type="search"
          placeholder="名前・本文・差し込んでいる項目で検索"
          aria-label="名前・本文・差し込んでいる項目で検索"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
          className="border-hairline rounded-control focus:ring-accent min-w-0 flex-1 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
        />
      </div>


      {folderActionError && (
        <div className="bg-danger-bg text-danger mb-4 rounded-control px-4 py-3 text-sm">
          {folderActionError}
        </div>
      )}

      {/* Type filter */}
      <div className="mb-4 flex flex-wrap gap-2">
        {([
          { key: 'all', label: '全て' },
          { key: 'text', label: 'テキスト' },
          { key: 'flex', label: 'Flex' },
          { key: 'image', label: '画像' },
          { key: 'question', label: '質問' },
          { key: 'unused', label: '未使用' },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTypeFilter(key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              typeFilter === key ? 'bg-accent text-on-accent' : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'
            }`}
            style={typeFilter === key ? { backgroundColor: 'var(--color-accent)' } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 bg-canvas rounded-card border border-hairline p-6">
          <h2 className="text-sm font-semibold text-ink mb-4">新規テンプレートを作成</h2>
          <div className="space-y-4 max-w-lg">
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">名前 <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full border border-hairline rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: コスト比較 flex"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <label className="block">
              <span className="block text-xs font-medium text-ink-secondary mb-1">フォルダ</span>
              <select
                className="v6-select w-full"
                value={form.folderId ?? ''}
                onChange={(e) => setForm({ ...form, folderId: e.target.value || null })}
              >
                <option value="">未分類</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.name}</option>
                ))}
              </select>
            </label>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">タイプ</label>
              <select
                className="w-full border border-hairline rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-canvas"
                value={form.messageType}
                onChange={(e) => setForm({ ...form, messageType: e.target.value })}
              >
                <option value="text">テキスト</option>
                <option value="flex">Flex</option>
                <option value="image">画像</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">内容 / JSON <span className="text-red-500">*</span></label>
              {form.messageType === 'image' ? (
                <ImageUploader
                  mode="line-image"
                  value={(() => {
                    try {
                      const parsed = JSON.parse(form.messageContent) as { originalContentUrl?: string; previewImageUrl?: string }
                      if (parsed.originalContentUrl) {
                        return {
                          mode: 'line-image' as const,
                          originalContentUrl: parsed.originalContentUrl,
                          previewImageUrl: parsed.previewImageUrl ?? parsed.originalContentUrl,
                        }
                      }
                    } catch { /* ignore */ }
                    return null
                  })()}
                  onChange={(v) => {
                    if (v?.mode === 'line-image') {
                      setForm((prev) => ({ ...prev, messageContent: JSON.stringify({
                        originalContentUrl: v.originalContentUrl,
                        previewImageUrl: v.previewImageUrl,
                      }) }))
                    } else {
                      setForm((prev) => ({ ...prev, messageContent: '' }))
                    }
                  }}
                  label="テンプレート画像"
                />
              ) : (
                <textarea
                  className="w-full border border-hairline rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
                  rows={form.messageType === 'flex' ? 10 : 4}
                  placeholder={form.messageType === 'flex' ? '{"type":"bubble","body":...}' : 'メッセージ内容'}
                  value={form.messageContent}
                  onChange={(e) => setForm({ ...form, messageContent: e.target.value })}
                />
              )}
            </div>

            {formError && <p className="text-xs text-red-600">{formError}</p>}

            <div className="flex gap-2">
              <Button
                onClick={handleCreate}
                disabled={saving}
                variant="primary"
              >
                {saving ? '作成中...' : '作成'}
              </Button>
              <Button
                onClick={() => { setShowCreate(false); setFormError('') }}
              >
                キャンセル
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      {accountLoading || loading ? (
        <div className="bg-canvas rounded-card border border-hairline overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-b border-hairline flex items-center gap-4 animate-pulse">
              <div className="h-5 bg-canvas-sunken rounded w-12" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-48" />
                <div className="h-2 bg-canvas-sunken rounded w-32" />
              </div>
              <div className="h-3 bg-canvas-sunken rounded w-12" />
              <div className="h-3 bg-canvas-sunken rounded w-24" />
            </div>
          ))}
        </div>
      ) : !selectedAccountId ? (
        <div className="bg-canvas rounded-card border-hairline border p-12 text-center">
          <p className="text-ink font-medium">
            {accounts.length > 0
              ? '上のバーでLINE公式アカウントを選んでください'
              : 'LINE公式アカウントが登録されていません'}
          </p>
        </div>
      ) : loadError ? (
        <div className="bg-danger-bg border-danger/30 rounded-card border p-12 text-center">
          <p className="text-danger font-medium">テンプレートを読み込めませんでした</p>
          <p className="text-ink-secondary mt-2 text-sm">{loadError}</p>
          <Button className="mt-4" variant="primary" onClick={() => void load()}>
            もう一度読み込む
          </Button>
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="bg-canvas rounded-card border border-hairline p-12 text-center">
          <p className="text-ink-faint">該当するテンプレートがありません</p>
        </div>
      ) : (
        <div className="bg-canvas rounded-card border border-hairline overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <TableHeadRow>
                  <Th>テンプレート</Th>
                  <Th>中身</Th>
                  <Th>使われている場所</Th>
                  <Th>送信数</Th>
                  <Th>更新</Th>
                  <Th>操作</Th>
                </TableHeadRow>
              </thead>
              <tbody className="divide-y divide-hairline">
                {filteredTemplates.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setDrawerId(t.id)}
                    className={`hover:bg-canvas-sunken cursor-pointer transition-colors ${drawerId === t.id ? 'bg-accent-soft' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            void toggleFavorite(t)
                          }}
                          aria-label={t.isFavorite ? `「${t.name}」をよく使うから外す` : `「${t.name}」をよく使うに追加`}
                          aria-pressed={t.isFavorite}
                          className={`shrink-0 text-base leading-none ${t.isFavorite ? 'text-warning' : 'text-ink-faint hover:text-warning'}`}
                        >
                          {t.isFavorite ? '★' : '☆'}
                        </button>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink">{t.name}</p>
                      <p className="text-[11px] text-ink-faint mt-0.5 truncate max-w-md">
                        {t.messageContent.slice(0, 60)}{t.messageContent.length > 60 ? '...' : ''}
                      </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium ${typeBadgeColor[t.question ? 'question' : t.messageType] ?? 'bg-canvas-sunken text-ink-secondary'}`}>
                        {messageTypeLabels[t.question ? 'question' : t.messageType] ?? t.messageType}
                      </span>
                      <p
                        className="text-ink-faint mt-1 max-w-40 truncate text-[11px]"
                        title={folderById.get(t.folderId ?? '')?.name ?? '未分類'}
                      >
                        {folderById.get(t.folderId ?? '')?.name ?? '未分類'}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-sm ${t.usageCount === 0 ? 'text-ink-faint' : 'text-ink font-medium'}`}>
                        {t.usageCount === 0 ? 'なし' : `${t.usageCount}件で使用`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-ink-faint text-sm" title="テンプレート別の送信数はまだ取得できません">—</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-faint">{formatDate(t.updatedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                      <a
                        href={`/broadcasts/new?templateId=${encodeURIComponent(t.id)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-md border border-hairline px-2.5 py-1 text-xs font-bold text-accent hover:bg-accent-soft"
                      >
                        一斉配信で使う
                      </a>
                      {t.usageCount > 0 ? (
                        <Button
                          onClick={(e) => { e.stopPropagation(); setDrawerId(t.id) }}
                        >
                          使用先を見る
                        </Button>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(t) }}
                          className="hover:bg-danger-bg rounded-md px-2.5 py-1 text-xs font-medium text-red-500"
                        >
                          テンプレートを削除
                        </button>
                      )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Drawer */}
      {drawerId && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-30 lg:hidden"
            onClick={() => setDrawerId(null)}
          />
          <div className="fixed inset-y-0 right-0 w-full lg:w-[480px] bg-canvas shadow-xl border-l border-hairline z-40 overflow-y-auto">
            <div className="px-4 py-3 border-b border-hairline flex items-center justify-between sticky top-0 bg-canvas z-10">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {editName !== null ? (
                  <input
                    type="text"
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 border border-hairline rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                ) : (
                  <h3
                    className="text-sm font-semibold truncate cursor-text"
                    onClick={() => setEditName(drawerData?.name ?? '')}
                    title="クリックで編集"
                  >
                    {drawerData?.name ?? '読み込み中...'}
                  </h3>
                )}
              </div>
              <button
                onClick={() => setDrawerId(null)}
                className="ml-2 text-ink-faint hover:text-ink-secondary text-2xl leading-none px-1"
              >
                ×
              </button>
            </div>

            {drawerLoading ? (
              <div className="p-6 text-sm text-ink-faint">読み込み中...</div>
            ) : drawerError ? (
              <div className="p-6">
                <p className="text-sm text-red-600 mb-2">読み込みに失敗しました</p>
                <p className="text-xs text-ink-faint">{drawerError}</p>
              </div>
            ) : !drawerData ? null : (
              <div className="p-4 space-y-5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${typeBadgeColor[drawerData.question ? 'question' : drawerData.messageType] ?? 'bg-canvas-sunken text-ink-secondary'}`}>
                    {messageTypeLabels[drawerData.question ? 'question' : drawerData.messageType] ?? drawerData.messageType}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-info-bg text-info">
                    {folderById.get(drawerData.folderId ?? '')?.name ?? '未分類'}
                  </span>
                  <span className="text-[10px] text-ink-faint">
                    更新: {formatDate(drawerData.updatedAt)}
                  </span>
                </div>

                {/* Preview */}
                <div>
                  <h4 className="text-[11px] font-medium text-ink-faint mb-1.5 uppercase tracking-wide">プレビュー</h4>
                  <div className="border border-hairline rounded-lg p-3 bg-canvas-sunken overflow-x-auto">
                    {drawerData.question ? (
                      <div className="space-y-2">
                        {drawerData.question.intro && <p className="text-sm whitespace-pre-wrap">{drawerData.question.intro}</p>}
                        <p className="text-sm font-semibold whitespace-pre-wrap">{drawerData.question.text}</p>
                        {drawerData.question.choices.map((choice, index) => (
                          <div key={index} className="border-hairline rounded-control border px-3 py-2 text-center text-xs font-semibold text-accent">
                            {choice.label}
                          </div>
                        ))}
                      </div>
                    ) : drawerData.messageType === 'flex' ? (
                      (() => {
                        try {
                          return <FlexPreviewComponent content={drawerData.messageContent} maxWidth={420} />
                        } catch {
                          return <p className="text-xs text-red-500">Flex JSON parse 失敗</p>
                        }
                      })()
                    ) : drawerData.messageType === 'image' ? (
                      (() => {
                        try {
                          const parsed = JSON.parse(drawerData.messageContent)
                          return <img src={parsed.originalContentUrl || parsed.previewImageUrl} alt="" className="max-w-full rounded" />
                        } catch {
                          return <pre className="text-xs whitespace-pre-wrap">{drawerData.messageContent}</pre>
                        }
                      })()
                    ) : (
                      <p className="text-sm whitespace-pre-wrap break-words">{drawerData.messageContent}</p>
                    )}
                  </div>
                </div>

                {/* Edit JSON / content */}
                {drawerData.question ? (
                  <Button
                    href={`/templates/questions/new?id=${encodeURIComponent(drawerData.id)}`}
                    variant="secondary"
                  >
                    質問を編集
                  </Button>
                ) : <div>
                  <h4 className="text-[11px] font-medium text-ink-faint mb-1.5 uppercase tracking-wide">内容 / JSON 編集</h4>
                  <textarea
                    rows={drawerData.messageType === 'flex' ? 12 : 4}
                    className="w-full border border-hairline rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
                    value={editContent ?? drawerData.messageContent}
                    onChange={(e) => setEditContent(e.target.value)}
                  />
                </div>}

                <label className="block">
                  <span className="text-ink-faint mb-1.5 block text-xs font-medium uppercase tracking-wide">
                    フォルダ
                  </span>
                  <select
                    className="v6-select w-full"
                    value={editFolderId === undefined ? drawerData.folderId ?? '' : editFolderId ?? ''}
                    onChange={(event) => setEditFolderId(event.target.value || null)}
                  >
                    <option value="">未分類</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>{folder.name}</option>
                    ))}
                  </select>
                </label>

                {(editContent !== null || editName !== null || editFolderId !== undefined) && (
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveEdit}
                      disabled={savingEdit}
                      className="bg-accent text-on-accent transition-colors hover:bg-accent-hover rounded-control px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                    >
                      {savingEdit ? '保存中...' : '保存'}
                    </button>
                    <button
                      onClick={() => {
                        setEditContent(null)
                        setEditName(null)
                        setEditFolderId(undefined)
                      }}
                      className="px-3 py-1.5 text-xs font-medium text-ink-secondary bg-canvas-sunken hover:bg-hairline rounded-md"
                    >
                      キャンセル
                    </button>
                  </div>
                )}

                {/* Used by */}
                <div>
                  <h4 className="text-[11px] font-medium text-ink-faint mb-1.5 uppercase tracking-wide">
                    使用箇所 ({drawerUsageCount})
                  </h4>
                  {drawerUsageCount === 0 ? (
                    <p className="text-[11px] text-ink-faint italic">どこからも使用されていません</p>
                  ) : (
                    <>
                      <ul className="space-y-1.5 text-xs">
                        {drawerData.usedBy.autoReplies.map((ar) => (
                          <li key={`ar-${ar.id}`}>
                            <a href="/auto-replies" className="text-accent hover:underline">
                              自動返信: {ar.keyword} <span className="text-ink-faint">({ar.matchType})</span>
                            </a>
                          </li>
                        ))}
                        {drawerData.usedBy.automations.map((au) => (
                          <li key={`au-${au.id}`}>
                            <a href="/automations" className="text-accent hover:underline">
                              オートメーション: {au.name} <span className="text-ink-faint">({au.eventType})</span>
                            </a>
                          </li>
                        ))}
                        {scenarioStepUsages.map((ss) => (
                          <li key={`ss-${ss.stepId}`}>
                            <a href={`/scenarios/detail?id=${ss.scenarioId}`} className="text-accent hover:underline">
                              シナリオ: {ss.scenarioName} <span className="text-ink-faint">#{ss.stepOrder}</span>
                            </a>
                          </li>
                        ))}
                        {reminderStepUsages.map((rs) => (
                          <li key={`rs-${rs.stepId}`}>
                            <a href={`/reminders/edit?id=${rs.reminderId}`} className="text-accent hover:underline">
                              リマインダ: {rs.reminderName}
                            </a>
                          </li>
                        ))}
                        {richMenuAreaUsages.map((area) => (
                          <li key={`rm-${area.areaId}`}>
                            <a href={`/rich-menus/edit?id=${area.groupId}`} className="text-accent hover:underline">
                              リッチメニュー: {area.groupName} / {area.pageName}{area.label ? ` / ${area.label}` : ''}
                            </a>
                          </li>
                        ))}
                        {trackedLinkUsages.map((link) => (
                          <li key={`tl-${link.id}`}>
                            <a href={`/inflow-links/detail?id=${link.id}`} className="text-accent hover:underline">
                              流入リンク: {link.name}
                            </a>
                          </li>
                        ))}
                      </ul>
                      {drawerUsageCount > 0 && (
                        <p className="mt-2 text-[10px] text-amber-700">
                          このテンプレートは使用中です。削除する前に使用先を差し替えてください。
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
      <div data-design-node="M9cij">
        <ConfirmDialog
          open={pendingDelete !== null}
          title="テンプレートを削除しますか？"
          description={`「${pendingDelete?.name ?? ''}」を削除します。この操作は元に戻せません。`}
          confirmLabel="テンプレートを削除"
          destructive
          busy={deleting}
          error={deleteError || undefined}
          onCancel={() => {
            if (deleting) return
            setPendingDelete(null)
            setDeleteError('')
          }}
          onConfirm={() => void confirmDelete()}
        />
      </div>
      {showFolderAdd && selectedAccountId && (
        <FolderAddDialog
          kind="template"
          lineAccountId={selectedAccountId}
          displayOrder={folders.length}
          note="このLINE公式アカウントだけで使うフォルダを追加します。"
          placeholder="例: 初回案内"
          onClose={() => setShowFolderAdd(false)}
          onAdded={() => void load()}
        />
      )}
      {editingFolder && selectedAccountId && (
        <FolderEditDialog
          key={editingFolder.id}
          folder={editingFolder}
          lineAccountId={selectedAccountId}
          onClose={() => setEditingFolder(null)}
          onSaved={(action) => {
            if (action === 'deleted' && selectedFolderId === editingFolder.id) {
              setSelectedFolderId('all')
            }
            void load()
          }}
        />
      )}
      <ConfirmDialog
        open={pendingFolderDelete !== null}
        title={`「${pendingFolderDelete?.name ?? ''}」を削除しますか？`}
        description="中のテンプレートは削除されず、「未分類」に残ります。"
        confirmLabel="フォルダを削除"
        destructive
        busy={folderActionBusy}
        error={folderActionError || undefined}
        onCancel={() => {
          if (folderActionBusy) return
          setPendingFolderDelete(null)
          setFolderActionError('')
        }}
        onConfirm={() => void confirmFolderDelete()}
      />
      </div>
      </div>
      </> : <BroadcastAssetManager kind={activeSection} />}
      </div>
    </div>
  )
}
