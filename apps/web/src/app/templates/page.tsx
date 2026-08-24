'use client'

import { useState, useEffect, useCallback } from 'react'
import { api, type BroadcastAssetKind } from '@/lib/api'
import Header from '@/components/layout/header'
import ListKpis from '@/components/shared/list-kpis'
import FlexPreviewComponent from '@/components/flex-preview'
import ImageUploader from '@/components/shared/image-uploader'
import BroadcastAssetManager from '@/components/broadcasts/broadcast-asset-manager'
import { TableHeadRow, Th } from '@/components/shared/table'
import Button from '@/components/shared/button'

interface Template {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
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
  usedBy: {
    autoReplies: Array<{ id: string; keyword: string; matchType: 'exact' | 'contains'; lineAccountId: string | null }>
    automations: Array<{ id: string; name: string; eventType: string }>
  }
  createdAt: string
  updatedAt: string
}

type TypeFilter = 'all' | 'text' | 'flex' | 'image' | 'unused'

const messageTypeLabels: Record<string, string> = {
  text: 'テキスト',
  image: '画像',
  flex: 'Flex',
  carousel: 'Carousel',
}

const typeBadgeColor: Record<string, string> = {
  text: 'bg-canvas-sunken text-ink-secondary',
  flex: 'bg-purple-100 text-purple-700',
  image: 'bg-info-bg text-info',
  carousel: 'bg-amber-100 text-amber-700',
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
  const [activeSection, setActiveSection] = useState<'message' | BroadcastAssetKind>('message')
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  // 名前の絞り込み（設計 `Body` の「テンプレート名で検索」）。
  const [nameQuery, setNameQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [form, setForm] = useState({ name: '', category: 'general', messageType: 'text', messageContent: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Drawer
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [drawerData, setDrawerData] = useState<TemplateDetail | null>(null)
  const [scenarioStepUsages, setScenarioStepUsages] = useState<Array<{
    scenarioId: string
    scenarioName: string
    stepId: string
    stepOrder: number
  }>>([])
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [drawerError, setDrawerError] = useState<string | null>(null)
  const [editContent, setEditContent] = useState<string | null>(null)
  const [editName, setEditName] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.templates.list()
      if (res.success) {
        setTemplates(res.data)
      } else {
        setError(res.error)
      }
    } catch {
      setError('テンプレートの読み込みに失敗しました。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Drawer fetch
  useEffect(() => {
    if (!drawerId) { setDrawerData(null); setDrawerError(null); setScenarioStepUsages([]); return }
    let cancelled = false
    setDrawerLoading(true)
    setDrawerError(null)
    setDrawerData(null)
    setScenarioStepUsages([])
    Promise.all([
      api.templates.get(drawerId),
      api.templates.usages(drawerId).catch(() => null),
    ]).then(([detailRes, usagesRes]) => {
      if (cancelled) return
      if (detailRes.success && detailRes.data) {
        setDrawerData(detailRes.data)
      } else {
        setDrawerError((detailRes as { error?: string }).error ?? '読み込みに失敗しました')
      }
      if (usagesRes && usagesRes.success) {
        setScenarioStepUsages(usagesRes.data.scenarioSteps)
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
  useEffect(() => { setEditContent(null); setEditName(null) }, [drawerId])

  const filteredTemplates = templates.filter((t) => {
    // 名前は手元で絞る。打つたびに取り直すと重い。
    if (nameQuery.trim() && !t.name.toLowerCase().includes(nameQuery.trim().toLowerCase())) {
      return false
    }
    if (typeFilter === 'all') return true
    if (typeFilter === 'unused') return t.usageCount === 0
    return t.messageType === typeFilter
  })

  const handleCreate = async () => {
    if (!form.name.trim()) { setFormError('テンプレート名を入力してください'); return }
    if (!form.messageContent.trim()) { setFormError('メッセージ内容を入力してください'); return }
    setSaving(true)
    setFormError('')
    try {
      const res = await api.templates.create(form)
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

  const handleDelete = async (id: string, usageCount: number) => {
    if (usageCount > 0) {
      if (!confirm(`このテンプレートは ${usageCount} 箇所で使用されています。削除すると参照がクリアされます。続行しますか？`)) return
    } else {
      if (!confirm('このテンプレートを削除しますか？')) return
    }
    try {
      await api.templates.delete(id)
      if (drawerId === id) setDrawerId(null)
      load()
    } catch {
      setError('削除に失敗しました')
    }
  }

  return (
    <div>
      <div data-design="Head">
      <Header
        title="テンプレート"
        description="配信で使うメッセージを管理します。友だち情報や共通情報を差し込むと、一人ひとりに合わせた文面になります。"
        action={activeSection === 'message' ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled
              title="マニュアルは準備中です"
            >
              マニュアル
            </Button>
            <Button
              disabled
              title="並び替えは準備中です"
            >
              並び替え
            </Button>
            {/* folders は 099 で入っているが templates.folder_id が無い。 */}
            <Button
              disabled
              title="フォルダの追加は準備中です"
            >
              フォルダを追加
            </Button>
            <Button
              onClick={() => setShowCreate(true)}
              variant="primary"
            >
              + 新規テンプレート
            </Button>
          </div>
        ) : undefined}
      />
      </div>

      <nav className="mb-6 flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-canvas p-2" aria-label="テンプレート種別">
        {([
          ['message', 'メッセージ'],
          ['rich_message', 'リッチメッセージ'],
          ['card_message', 'カードタイプ'],
          ['coupon', 'クーポン'],
          ['research', 'リサーチ'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => { setActiveSection(id); setShowCreate(false) }}
            className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-bold ${activeSection === id ? 'bg-accent text-on-accent' : 'text-ink-secondary hover:bg-canvas-sunken'}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* 設計の KPI 4枚。数は /api/list-stats から4画面ぶんまとめて来る。 */}
      <div data-design="KPIs">
      {activeSection === 'message' && <ListKpis
        variant="v6"
        build={(s) => [
            { title: 'テンプレート', value: s.templates.total, unit: '件', detail: `使用中 ${s.templates.inUse}` },
            {
              title: '今月の送信',
              value: s.templates.sentThisMonth,
              unit: '通',
              detail: 'テンプレート経由を含む全送信',
            },
            // 設計は「平均クリック率」。短縮URL経由の実測をテンプレート単位で
            // 集計する口がまだ無い。使われていない数のほうが、いま手を打てる。
            { title: '未使用', value: s.templates.unused90d, unit: '件', detail: 'どこからも参照されていない' },
            { title: '使用中', value: s.templates.inUse, unit: '件', detail: 'シナリオ・自動応答から参照' },
        ]}
      />}
      </div>

      {/* 一覧本体（設計 `Body`）。 */}
      <div data-design="Body">
      {activeSection === 'message' ? <>
      {/*
        フォルダ（設計 `Body` の左）。folders は 099 で入っているが
        templates.folder_id が無いので絞り込めない。枠だけ置く。
      */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-ink-faint text-xs">フォルダ</span>
        {['すべて', '01_定期便', '02_健康フォロー', '未分類'].map((label, i) => (
          <button
            key={label}
            disabled={i > 0}
            title={i > 0 ? 'フォルダ分けは準備中です' : undefined}
            className={`rounded-pill px-3 py-1 text-xs ${
              i === 0 ? 'bg-accent text-on-accent' : 'border-hairline text-ink-faint border opacity-50'
            }`}
          >
            {label}
          </button>
        ))}
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
        <span className="text-ink-faint text-xs whitespace-nowrap">並び順</span>
        <select disabled title="並び替えは準備中です" className="border-hairline rounded-control border px-2 py-2 text-sm opacity-50">
          <option>使用回数が多い順</option>
        </select>
        <Button disabled title="保存した条件は準備中です">
          保存した条件
        </Button>
      </div>


      {error && (
        <div className="mb-4 p-4 bg-danger-bg border border-danger-bg rounded-lg text-danger text-sm">
          {error}
        </div>
      )}

      {/* Type filter */}
      <div className="mb-4 flex flex-wrap gap-2">
        {([
          { key: 'all', label: '全て' },
          { key: 'text', label: 'テキスト' },
          { key: 'flex', label: 'Flex' },
          { key: 'image', label: '画像' },
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

      {/* Table */}
      {loading ? (
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
                  {/*
                    列は設計 `V2 4-3 テンプレート` の並び。
                    「カテゴリ」を「本文」に替えた。名前だけでは中身が
                    分からず、開かないと選べない。冒頭が見えていれば
                    一覧のまま選べる。
                  */}
                  <Th>種別</Th>
                  <Th>名前</Th>
                  <Th>本文</Th>
                  <Th>使われている配信</Th>
                  <Th>ヒット数</Th>
                  <Th>登録日</Th>
                  <Th />
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
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${typeBadgeColor[t.messageType] ?? 'bg-canvas-sunken text-ink-secondary'}`}>
                        {messageTypeLabels[t.messageType] ?? t.messageType}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-ink">{t.name}</p>
                      <p className="text-[11px] text-ink-faint mt-0.5 truncate max-w-md">
                        {t.messageContent.slice(0, 60)}{t.messageContent.length > 60 ? '...' : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-info-bg text-info">
                        {t.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-sm ${t.usageCount === 0 ? 'text-ink-faint' : 'text-ink font-medium'}`}>
                        {t.usageCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {/* 押される仕掛け（カルーセルの選択肢など）が無いものは 0 のまま。
                          「-」にしないのは、0 と「数えられない」を見分けられなくなるため。 */}
                      <span
                        className={`text-sm tabular-nums ${t.tapCount === 0 ? 'text-ink-faint' : 'text-ink font-medium'}`}
                      >
                        {t.tapCount}
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
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(t.id, t.usageCount) }}
                        className="px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-danger-bg rounded-md"
                      >
                        削除
                      </button>
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
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${typeBadgeColor[drawerData.messageType] ?? 'bg-canvas-sunken text-ink-secondary'}`}>
                    {messageTypeLabels[drawerData.messageType] ?? drawerData.messageType}
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
                    {drawerData.messageType === 'flex' ? (
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
                <div>
                  <h4 className="text-[11px] font-medium text-ink-faint mb-1.5 uppercase tracking-wide">内容 / JSON 編集</h4>
                  <textarea
                    rows={drawerData.messageType === 'flex' ? 12 : 4}
                    className="w-full border border-hairline rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
                    value={editContent ?? drawerData.messageContent}
                    onChange={(e) => setEditContent(e.target.value)}
                  />
                </div>

                {(editContent !== null || editName !== null) && (
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveEdit}
                      disabled={savingEdit}
                      className="bg-accent text-on-accent transition-colors hover:bg-accent-hover rounded-control px-3 py-1.5 text-xs font-medium disabled:opacity-50"
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
                    使用箇所 ({drawerData.usedBy.autoReplies.length + drawerData.usedBy.automations.length + scenarioStepUsages.length})
                  </h4>
                  {(drawerData.usedBy.autoReplies.length === 0 && drawerData.usedBy.automations.length === 0 && scenarioStepUsages.length === 0) ? (
                    <p className="text-[11px] text-ink-faint italic">どこからも使用されていません</p>
                  ) : (
                    <>
                      <ul className="space-y-1.5 text-xs">
                        {drawerData.usedBy.autoReplies.map((ar) => (
                          <li key={`ar-${ar.id}`}>
                            <a href="/auto-replies" className="text-blue-600 hover:underline">
                              自動返信: {ar.keyword} <span className="text-ink-faint">({ar.matchType})</span>
                            </a>
                          </li>
                        ))}
                        {drawerData.usedBy.automations.map((au) => (
                          <li key={`au-${au.id}`}>
                            <a href="/automations" className="text-blue-600 hover:underline">
                              オートメーション: {au.name} <span className="text-ink-faint">({au.eventType})</span>
                            </a>
                          </li>
                        ))}
                        {scenarioStepUsages.map((ss) => (
                          <li key={`ss-${ss.stepId}`}>
                            <a href={`/scenarios/detail?id=${ss.scenarioId}`} className="text-blue-600 hover:underline">
                              シナリオ: {ss.scenarioName} <span className="text-ink-faint">#{ss.stepOrder}</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                      {scenarioStepUsages.length > 0 && (
                        <p className="mt-2 text-[10px] text-amber-700">
                          ⚠ このテンプレートを修正すると、上記すべてに一斉反映されます
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
      </> : <BroadcastAssetManager kind={activeSection} />}
      </div>
    </div>
  )
}
