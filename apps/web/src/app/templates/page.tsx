'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { api, type BroadcastAssetKind, type TemplateQuestion } from '@/lib/api'
import FlexPreviewComponent from '@/components/flex-preview'
import ImageUploader from '@/components/shared/image-uploader'
import BroadcastAssetManager from '@/components/broadcasts/broadcast-asset-manager'
import { TableHeadRow, Th } from '@/components/shared/table'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { Tabs } from '@/components/shared/tabs'
import FolderPanel from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import type { Folder } from '@line-crm/shared'
import {
  createBlockedReason,
  failureOf,
  failureOfResponse,
  listView,
  type TemplatesFailure,
} from './list-state-kind'
import { templateDeleteDescription } from './template-delete-message'
import styles from './templates-v6.module.css'
import { useAccount } from '@/contexts/account-context'

interface Template {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
  /** 置き場。未分類は null。一覧の口が返している。 */
  folderId: string | null
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
  const [assetCounts, setAssetCounts] = useState<Partial<Record<BroadcastAssetKind, number>>>({})
  const [loading, setLoading] = useState(true)
  /** 一覧を読み込めなかった理由。**取得失敗と権限不足を分ける。** */
  const [failure, setFailure] = useState<TemplatesFailure | null>(null)
  /** 操作（更新・削除）が失敗したときの帯。一覧の読み込み失敗とは別。 */
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  // 名前の絞り込み（設計 `Body` の「テンプレート名で検索」）。
  const [nameQuery, setNameQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [form, setForm] = useState({ name: '', category: 'general', messageType: 'text', messageContent: '' })
  /*
    フォルダ。**`category`（テンプレートが持つ文字列）から組み立てるのを
    やめ、本物のフォルダを読む。** 設計 `CzndJ` は「フォルダはアカウントで
    1組」で、名前・色・並び順・削除を持つ。文字列から組み立てると、
    空のフォルダが作れず、名前を直すと中身が散らばる。
  */
  const [folders, setFolders] = useState<Folder[]>([])
  const [folderError, setFolderError] = useState('')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null)
  const [folderBusy, setFolderBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  /**
   * 削除の確認。ブラウザの `confirm()` は見た目がブラウザ任せで、
   * 何が止まり・何が残るのかを本文で読ませられず、画像比較にも写らない。
   * 共通の `ConfirmDialog` へ移した（設計 `H2S1T4` / `M9cij`）。
   * 使用数も持たせて、本文を使用数で言い分ける。
   */
  const [pendingDelete, setPendingDelete] = useState<
    { id: string; name: string; usageCount: number } | null
  >(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // Drawer
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [drawerData, setDrawerData] = useState<TemplateDetail | null>(null)
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [drawerError, setDrawerError] = useState<string | null>(null)
  const [editContent, setEditContent] = useState<string | null>(null)
  const [editName, setEditName] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  useEffect(() => {
    activeAccountRef.current = selectedAccountId
    setDrawerId(null)
    setShowCreate(false)
    setPendingDelete(null)
    setDeleteError('')
  }, [selectedAccountId])

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setTemplates([])
      setFailure(null)
      setLoading(false)
      return
    }
    const accountId = selectedAccountId
    setLoading(true)
    setError('')
    setFailure(null)
    // アカウントを切り替えたとき、前のアカウントの行を残さない。
    setTemplates([])
    try {
      const res = await api.templates.list(undefined, accountId)
      if (activeAccountRef.current !== accountId) return
      if (res.success) {
        setTemplates(res.data)
      } else {
        setFailure(failureOfResponse())
      }
    } catch (e) {
      if (activeAccountRef.current === accountId) {
        // 権限不足を「読み込めませんでした」に混ぜない。
        setFailure(failureOf(e))
      }
    } finally {
      if (activeAccountRef.current === accountId) setLoading(false)
    }
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
        setDrawerError('テンプレートの詳細を読み込めませんでした。')
      }
    }).catch(() => {
      if (cancelled) return
      setDrawerError('テンプレートの詳細を読み込めませんでした。')
    }).finally(() => {
      if (!cancelled) setDrawerLoading(false)
    })
    return () => { cancelled = true }
  }, [drawerId])

  // reset edits when drawer changes
  useEffect(() => { setEditContent(null); setEditName(null) }, [drawerId])

  const filteredTemplates = templates.filter((t) => {
    // 名前は手元で絞る。打つたびに取り直すと重い。
    if (nameQuery.trim() && !t.name.toLowerCase().includes(nameQuery.trim().toLowerCase())) {
      return false
    }
    /*
      フォルダで絞る。**`category` の文字列ではなく `folderId` で見る。**
      `unfiled` は置き場の無いもの。
    */
    if (selectedCategory === 'unfiled' && t.folderId !== null) return false
    if (selectedCategory !== 'all' && selectedCategory !== 'unfiled' && t.folderId !== selectedCategory) return false
    if (typeFilter === 'all') return true
    if (typeFilter === 'unused') return t.usageCount === 0
    if (typeFilter === 'question') return Boolean(t.question)
    if (typeFilter === 'text') return t.messageType === 'text' && t.question === null
    return t.messageType === typeFilter
  })

  /** フォルダを読み直す。並び順は API の `displayOrder` に従う。 */
  const loadFolders = useCallback(async () => {
    setFolderError('')
    try {
      const res = await api.folders.list('template')
      if (res.success) setFolders(res.data)
      else setFolderError('フォルダを読み込めませんでした。')
    } catch {
      setFolderError('フォルダを読み込めませんでした。')
    }
  }, [])

  useEffect(() => { void loadFolders() }, [loadFolders])

  /**
   * 並び順を入れ替える。
   *
   * **隣と番号を交換する。** 全部に振り直すと、同時に触った人の並びを
   * 上書きしてしまう。端の行には押し口を出さないので、隣は必ずある。
   */
  const moveFolder = async (index: number, direction: -1 | 1) => {
    const target = folders[index]
    const neighbor = folders[index + direction]
    if (!target || !neighbor) return
    setFolderBusy(true)
    setFolderError('')
    try {
      await api.folders.update(target.id, { displayOrder: neighbor.displayOrder })
      await api.folders.update(neighbor.id, { displayOrder: target.displayOrder })
      await loadFolders()
    } catch {
      setFolderError('並び順を変えられませんでした。')
    } finally {
      setFolderBusy(false)
    }
  }

  const removeFolder = async () => {
    if (!deletingFolder) return
    setFolderBusy(true)
    setFolderError('')
    try {
      const res = await api.folders.delete(deletingFolder.id)
      if (!res.success) throw new Error(res.error ?? '削除できませんでした')
      setDeletingFolder(null)
      if (selectedCategory === deletingFolder.id) setSelectedCategory('all')
      await loadFolders()
    } catch {
      setFolderError('フォルダを削除できませんでした。')
    } finally {
      setFolderBusy(false)
    }
  }

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
        setForm({ name: '', category: 'general', messageType: 'text', messageContent: '' })
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
      const updates: Record<string, string> = {}
      if (editContent !== null) updates.messageContent = editContent
      if (editName !== null) updates.name = editName
      await api.templates.update(drawerData.id, updates)
      const r = await api.templates.get(drawerData.id)
      if (r.success && r.data) setDrawerData(r.data)
      setEditContent(null)
      setEditName(null)
      load()
    } catch {
      setError('更新に失敗しました')
    }
    setSavingEdit(false)
  }

  // 押しただけでは消さない。窓を開くだけにする。使用中なら使用先へ送る。
  const handleDelete = (template: Pick<Template, 'id' | 'name' | 'usageCount'>) => {
    const { id, name, usageCount } = template
    if (usageCount > 0) {
      setDrawerId(id)
      setError(`${usageCount}件で使用中です。使用先を差し替えてから削除してください。`)
      return
    }
    setDeleteError('')
    setPendingDelete({ id, name, usageCount })
  }

  const confirmDelete = async () => {
    // 押している間は受け付けない。二度押しで2回目が404になり、
    // 「削除できませんでした」とだけ出て消えている、という食い違いが起きる。
    if (!pendingDelete || deleting) return
    const target = pendingDelete
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await api.templates.delete(target.id)
      if (!res.success) throw new Error(res.error)
      setPendingDelete(null)
      if (drawerId === target.id) setDrawerId(null)
      await load()
    } catch {
      // 生のAPIエラーは運用者に読めないので、窓の中に運用の言葉で出す。
      setDeleteError('このテンプレートを削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  // 一覧に何を出すか。**読込中・取得失敗・権限不足・空・0件を混ぜない。**
  const view = listView({
    loading,
    failure,
    total: templates.length,
    matched: filteredTemplates.length,
  })
  const createBlocked = createBlockedReason({ loading, failure })

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
    <div data-design-node="W7LBc">
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
            {/* 押せない理由は本文に出す。押せないボタンを黙って置かない。 */}
            <Button
              onClick={() => {
                if (!selectedAccountId) {
                  setError('上のバーでLINE公式アカウントを選んでください')
                  return
                }
                setShowCreate(true)
              }}
              variant="primary"
              disabled={createBlocked !== null}
              aria-describedby={createBlocked ? 'tpl-create-blocked' : undefined}
            >
              テンプレートを作る
            </Button>
            <Button href="/templates/questions/new" variant="secondary">
              質問を作る
            </Button>
            {createBlocked && (
              <p id="tpl-create-blocked" className="text-ink-faint text-xs">
                {createBlocked}
              </p>
            )}
          </div>
        </div>
      )}

      {/* 一覧本体（設計 `Body`）。 */}
      <div className={styles.body} data-design="Body">
      {activeSection === 'message' ? <>
      <div className={styles.contentLayout}>
      {/*
        フォルダの帯。**本物のフォルダを出す。**
        以前は `category`（テンプレートが持つ文字列）から組み立てていたので、
        空のフォルダを作れず、名前を直すと中身が散らばった。
      */}
      <div className={`${styles.folderRail} shrink-0`}>
        <FolderPanel
          total={`${folders.length} 件`}
          activeId={selectedCategory}
          onSelect={setSelectedCategory}
          rows={[
            { id: 'all', label: 'すべて', count: templates.length },
            ...folders.map((folder, index) => ({
              id: folder.id,
              label: folder.name,
              count: templates.filter((t) => t.folderId === folder.id).length,
              color: folder.color,
              onEdit: () => setEditingFolder(folder),
              // 端の行には口を出さない。押せない矢印を置かない。
              onMoveUp: index > 0 ? () => void moveFolder(index, -1) : undefined,
              onMoveDown: index < folders.length - 1 ? () => void moveFolder(index, 1) : undefined,
              onDelete: () => setDeletingFolder(folder),
              deleteNote: '削除しても、中のテンプレートは未分類に残ります。',
            })),
            {
              id: 'unfiled',
              label: '未分類',
              count: templates.filter((t) => t.folderId === null).length,
            },
          ]}
        >
          <Button type="button" onClick={() => setFolderDialogOpen(true)} className="w-full">
            フォルダを追加
          </Button>
          {folderError ? <p role="alert" className="text-danger text-xs">{folderError}</p> : null}
          {/*
            **移せないことを、その場で断る。** フォルダは作れるが、
            テンプレートを入れる口がまだ無い（`POST`/`PUT /api/templates` が
            `folderId` を受けない）。作れるのに移せないと、
            「入れたのに反映されない」と読まれる。
          */}
          <p className="text-ink-faint text-xs leading-relaxed">
            テンプレートをフォルダへ移す操作は、まだ繋がっていません。
            置き場を保存する口が接続されると使えます。
          </p>
        </FolderPanel>
      </div>
      <div className="min-w-0 flex-1">

      {/*
        案内帯（V6 §2-3）。**できないことを「できます」と書かない。**
        送信数はまだ口が無いので、表では `—` のままになる。
      */}
      <div className="bg-info-bg text-info mb-3 rounded-control px-3 py-2 text-xs">
        一覧からテンプレートの中身と、使われている場所を確認できます。送信数はまだ繋がっていません。テンプレート別の送信集計が接続されると表示されます。
      </div>

      {/* 検索と並び順（設計 `Body` の上）。 */}
      <div className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3">
        <input
          type="search"
          placeholder="テンプレート名で検索"
          aria-label="テンプレート名で検索"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
          className="border-hairline rounded-control focus:ring-accent min-w-0 flex-1 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
        />
      </div>


      {error && (
        <div
          className="mb-4 p-4 bg-danger-bg border border-danger-bg rounded-lg text-danger text-sm"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Type filter */}
      <div className="mb-4 flex flex-wrap gap-2">
        {([
          { key: 'all', label: 'すべて' },
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
              typeFilter === key ? 'bg-accent-deep text-on-accent' : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'
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
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">カテゴリ</label>
              <input
                type="text"
                className="w-full border border-hairline rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: general, 挨拶, 返信"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </div>
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

      {/*
        一覧の状態。**「まだ1件も無い」「絞り込みに合わない」「読み込めない」
        「権限がない」を言い分ける。** 以前は4つとも同じ1文だったので、
        読み込みに失敗したときも、登録したものが消えたように見えていた。
        アカウント未選択は development が足した5つ目の言い分け。**同じ文へ
        まとめない。** 選ぶまでは読みに行っていないので、失敗ではない。
      */}
      {accountLoading || view === 'loading' ? (
        <ListState kind="loading" title="読み込んでいます" />
      ) : !selectedAccountId ? (
        <ListState
          kind="empty"
          title={
            accounts.length > 0
              ? '上のバーでLINE公式アカウントを選んでください'
              : 'LINE公式アカウントが登録されていません'
          }
        />
      ) : view === 'forbidden' ? (
        <ListState kind="forbidden" title={failure?.title} description={failure?.description} />
      ) : view === 'error' ? (
        <ListState
          kind="error"
          title={failure?.title}
          description={failure?.description}
          action={
            <Button onClick={() => void load()} variant="secondary">
              再読み込み
            </Button>
          }
        />
      ) : view === 'empty' ? (
        <ListState
          kind="empty"
          title="まだテンプレートがありません"
          description="よく送る文を登録しておくと、配信・自動応答から選べます。"
        />
      ) : view === 'no-match' ? (
        <ListState
          kind="empty"
          title="条件に合うテンプレートはありません"
          description={`${templates.length}件のうち0件が一致しました。検索語か絞り込みを変えてください。`}
        />
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
                      <p className="text-sm font-medium text-ink">{t.name}</p>
                      <p className="text-[11px] text-ink-faint mt-0.5 truncate max-w-md">
                        {t.messageContent.slice(0, 60)}{t.messageContent.length > 60 ? '...' : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium ${typeBadgeColor[t.question ? 'question' : t.messageType] ?? 'bg-canvas-sunken text-ink-secondary'}`}>
                        {messageTypeLabels[t.question ? 'question' : t.messageType] ?? t.messageType}
                      </span>
                      <p className="text-ink-faint mt-1 max-w-40 truncate text-[11px]" title={t.category}>{t.category || '未分類'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-sm ${t.usageCount === 0 ? 'text-ink-faint' : 'text-ink font-medium'}`}>
                        {/*
                          **取れていないのを「0件」とも「undefined件」とも言わない。**
                          `usageCount` が入っていないひな形で「undefined件で使用」と
                          出ていた（一覧の20行すべて）。
                        */}
                        {typeof t.usageCount !== 'number' ? '使用先を確認できません' : t.usageCount === 0 ? 'なし' : `${t.usageCount}件で使用`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className="text-ink-faint text-sm"
                        title="まだ繋がっていません。テンプレート別の送信集計が接続されると表示されます。"
                      >
                        —
                      </span>
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
                    {drawerData.category}
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

                {(editContent !== null || editName !== null) && (
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveEdit}
                      disabled={savingEdit}
                      className="bg-accent-deep text-on-accent transition-colors hover:brightness-92 rounded-control px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                    >
                      {savingEdit ? '保存中...' : '保存'}
                    </button>
                    <button
                      onClick={() => { setEditContent(null); setEditName(null) }}
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
          title={`テンプレート「${pendingDelete?.name ?? ''}」を削除しますか？`}
          description={templateDeleteDescription(pendingDelete?.usageCount ?? 0)}
          confirmLabel="削除する"
          destructive
          busy={deleting}
          error={deleteError}
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            if (deleting) return
            setPendingDelete(null)
            setDeleteError('')
          }}
        />
      </div>

      {folderDialogOpen && (
        <FolderAddDialog
          kind="template"
          note="テンプレートを分けてしまう箱です。削除しても、中のテンプレートは未分類に残ります。"
          placeholder="例: 01_定期便"
          onClose={() => setFolderDialogOpen(false)}
          onAdded={() => { setFolderDialogOpen(false); void loadFolders() }}
        />
      )}

      {editingFolder && (
        <FolderAddDialog
          kind="template"
          folder={editingFolder}
          note="テンプレートを分けてしまう箱です。削除しても、中のテンプレートは未分類に残ります。"
          placeholder="例: 01_定期便"
          onClose={() => setEditingFolder(null)}
          onAdded={() => { setEditingFolder(null); void loadFolders() }}
        />
      )}

      {/*
        **消す前に、中身がどうなるかを本文で読ませる。**
        設計 `CzndJ` の「削除しても、中のテンプレートは未分類に残ります。」。
        吹き出しだけでは読めない。
      */}
      <ConfirmDialog
        open={deletingFolder !== null}
        title={`フォルダ「${deletingFolder?.name ?? ''}」を削除しますか？`}
        description={`削除しても、中のテンプレートは未分類に残ります。いまこのフォルダに入っているのは${
          deletingFolder ? templates.filter((t) => t.folderId === deletingFolder.id).length : 0
        }件です。`}
        confirmLabel="削除する"
        destructive
        busy={folderBusy}
        error={folderError || undefined}
        onCancel={() => { if (!folderBusy) { setDeletingFolder(null); setFolderError('') } }}
        onConfirm={() => void removeFolder()}
      />
      </div>
      </div>
      </> : <BroadcastAssetManager kind={activeSection} />}
      </div>
    </div>
  )
}
