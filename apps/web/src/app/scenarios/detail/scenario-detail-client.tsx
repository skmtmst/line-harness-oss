'use client'

import { useState, useEffect, useCallback } from 'react'

import Link from 'next/link'
import type { Scenario, ScenarioStep, ScenarioTriggerType, MessageType, DeliveryMode } from '@line-crm/shared'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import FlexPreviewComponent from '@/components/flex-preview'
import ScheduleInput, {
  emptySchedule,
  buildSchedulePayload,
  uiFromOffsetMinutes,
  type ScheduleValue,
} from '@/components/scenarios/schedule-input'
import BulkPreviewModal from '@/components/scenarios/bulk-preview-modal'

type ScenarioWithSteps = Scenario & { steps: ScenarioStep[] }

const triggerOptions: { value: ScenarioTriggerType; label: string }[] = [
  { value: 'friend_add', label: '友だち追加時' },
  { value: 'tag_added', label: 'タグ付与時' },
  { value: 'manual', label: '手動' },
]

const messageTypeOptions: { value: MessageType; label: string }[] = [
  { value: 'text', label: 'テキスト' },
  { value: 'image', label: '画像' },
  { value: 'flex', label: 'Flex' },
]

const modeBadgeStyle: Record<DeliveryMode, { bg: string; text: string; label: string }> = {
  relative: { bg: 'bg-canvas-sunken', text: 'text-ink-secondary', label: 'Legacy' },
  elapsed: { bg: 'bg-blue-50', text: 'text-blue-700', label: '経過時間' },
  absolute_time: { bg: 'bg-amber-50', text: 'text-amber-700', label: '時刻指定' },
}

function formatDelay(minutes: number): string {
  if (minutes === 0) return '即時'
  if (minutes < 60) return `${minutes}分後`
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m === 0 ? `${h}時間後` : `${h}時間${m}分後`
  }
  const d = Math.floor(minutes / 1440)
  const remaining = minutes % 1440
  if (remaining === 0) return `${d}日後`
  const h = Math.floor(remaining / 60)
  return h > 0 ? `${d}日${h}時間後` : `${d}日${remaining}分後`
}

function formatScheduleLabel(mode: DeliveryMode | undefined, step: ScenarioStep): string {
  const m = mode ?? 'relative'
  if (m === 'relative') return formatDelay(step.delayMinutes)
  if (m === 'elapsed') {
    const days = step.offsetDays ?? 0
    const mins = step.offsetMinutes ?? 0
    const h = Math.floor(mins / 60)
    const r = mins % 60
    if (days === 0 && mins === 0) return '即時 (購読開始)'
    const parts: string[] = []
    if (days > 0) parts.push(`${days}日`)
    if (h > 0) parts.push(`${h}時間`)
    if (r > 0) parts.push(`${r}分`)
    return `購読開始から${parts.join('')}後`
  }
  // absolute_time
  return `購読開始から${step.offsetDays ?? 0}日後の ${step.deliveryTime ?? '00:00'}`
}

interface StepFormState {
  stepOrder: number
  schedule: ScheduleValue
  messageType: MessageType
  messageContent: string
  templateId: string | null
  onReachTagId: string | null
  inputMode: 'direct' | 'template'
}

function emptyStepForm(stepOrder: number): StepFormState {
  return {
    stepOrder,
    schedule: { ...emptySchedule },
    messageType: 'text',
    messageContent: '',
    templateId: null,
    onReachTagId: null,
    inputMode: 'direct',
  }
}

interface TemplateOpt {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
}

interface TagOpt {
  id: string
  name: string
}

interface ScenarioStats {
  enrolledTotal: number
  activeNow: number
  completed: number
  paused: number
  steps: Array<{ stepOrder: number; reachedCount: number; reachRate: number }>
}

function FlexPreview({ content }: { content: string }) {
  return <FlexPreviewComponent content={content} maxWidth={300} />
}

function ImagePreview({ content }: { content: string }) {
  try {
    const parsed = JSON.parse(content)
    const url = parsed.previewImageUrl || parsed.originalContentUrl
    return (
      <div>
        <span className="text-xs font-medium text-purple-600 bg-purple-50 px-2 py-0.5 rounded mb-2 inline-block">画像</span>
        {url ? (
          <img src={url} alt="preview" className="max-w-[200px] rounded-lg border border-hairline mt-1" />
        ) : (
          <p className="text-xs text-ink-faint">プレビューなし</p>
        )}
      </div>
    )
  } catch {
    return <p className="text-xs text-red-500">画像 JSON パースエラー</p>
  }
}

/**
 * 設定の札1枚。設計は5枚を横に並べ、直せるものだけ右上に入口を出す。
 *
 * 直す先が無いものに入口を付けると、押しても何も起きない札ができる。
 * action を渡さなければ、読むだけの札になる。
 */
function SettingCard({
  label,
  action,
  onAction,
  children,
}: {
  label: string
  action?: string
  onAction?: () => void
  children: React.ReactNode
}) {
  return (
    <div className="bg-canvas rounded-card border-hairline border p-4">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <p className="text-ink-faint text-xs">{label}</p>
        {action && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="text-accent shrink-0 text-xs hover:underline"
          >
            {action}
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

export default function ScenarioDetailClient({ scenarioId }: { scenarioId: string }) {
  const id = scenarioId

  const [scenario, setScenario] = useState<ScenarioWithSteps | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', description: '', triggerType: 'friend_add' as ScenarioTriggerType, isActive: true, allowConcurrent: true })
  const [saving, setSaving] = useState(false)

  const [showStepForm, setShowStepForm] = useState(false)
  const [editingStepId, setEditingStepId] = useState<string | null>(null)
  const [stepForm, setStepForm] = useState<StepFormState>(() => emptyStepForm(1))
  const [stepSaving, setStepSaving] = useState(false)
  const [stepError, setStepError] = useState('')

  const [previewOpen, setPreviewOpen] = useState(false)

  const [stats, setStats] = useState<ScenarioStats | null>(null)
  const [templates, setTemplates] = useState<TemplateOpt[]>([])
  const [tags, setTags] = useState<TagOpt[]>([])

  const deliveryMode: DeliveryMode = (scenario?.deliveryMode ?? 'relative') as DeliveryMode

  const loadScenario = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.scenarios.get(id)
      if (res.success) {
        setScenario(res.data)
        setEditForm({
          name: res.data.name,
          description: res.data.description ?? '',
          triggerType: res.data.triggerType,
          isActive: res.data.isActive,
          allowConcurrent: res.data.allowConcurrent !== false,
        })
      } else {
        setError(res.error)
      }
    } catch {
      setError('シナリオの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadScenario()
  }, [loadScenario])

  // 並列で stats / templates / tags を取得（リグレッションを起こさないよう失敗は無視）
  useEffect(() => {
    if (!id) return
    let cancelled = false
    Promise.all([
      api.scenarios.stats(id).catch(() => null),
      api.templates.list().catch(() => null),
      api.tags.list().catch(() => null),
    ]).then(([statsRes, tplRes, tagRes]) => {
      if (cancelled) return
      if (statsRes && statsRes.success) setStats(statsRes.data)
      if (tplRes && tplRes.success) {
        setTemplates(tplRes.data.map((t) => ({
          id: t.id,
          name: t.name,
          category: t.category,
          messageType: t.messageType,
          messageContent: t.messageContent,
        })))
      }
      if (tagRes && tagRes.success) {
        setTags(tagRes.data.map((t) => ({ id: t.id, name: t.name })))
      }
    })
    return () => { cancelled = true }
  }, [id])

  const reloadStats = useCallback(() => {
    api.scenarios.stats(id).then((r) => { if (r.success) setStats(r.data) }).catch(() => {})
  }, [id])

  /**
   * 重複購読の許可を切り替える。
   *
   * 編集モードに入らずその場で当てる。読むだけの説明の隣にあるものなので、
   * 「編集 → 変更 → 保存」を挟むと、何を編集しているのか分からなくなる。
   */
  const handleConcurrentChange = async (allow: boolean) => {
    if (!scenario || (scenario.allowConcurrent ?? true) === allow) return
    setError('')
    try {
      const res = await api.scenarios.update(id, { allowConcurrent: allow })
      if (res.success) loadScenario()
      else setError(res.error)
    } catch {
      setError('重複購読の設定を変更できませんでした')
    }
  }

  const handleSaveScenario = async () => {
    if (!editForm.name.trim()) return
    setSaving(true)
    try {
      const res = await api.scenarios.update(id, {
        name: editForm.name,
        description: editForm.description || null,
        triggerType: editForm.triggerType,
        isActive: editForm.isActive,
        allowConcurrent: editForm.allowConcurrent,
      })
      if (res.success) {
        setEditing(false)
        loadScenario()
      } else {
        setError(res.error)
      }
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const openAddStep = () => {
    const nextOrder = scenario ? (scenario.steps.length > 0 ? Math.max(...scenario.steps.map(s => s.stepOrder)) + 1 : 1) : 1
    setStepForm(emptyStepForm(nextOrder))
    setEditingStepId(null)
    setShowStepForm(true)
    setStepError('')
  }

  const openEditStep = (step: ScenarioStep) => {
    const ui = uiFromOffsetMinutes(step.offsetMinutes)
    setStepForm({
      stepOrder: step.stepOrder,
      schedule: {
        delayMinutes: step.delayMinutes,
        offsetDays: step.offsetDays ?? 0,
        offsetHours: ui.offsetHours,
        offsetMinutesRemainder: ui.offsetMinutesRemainder,
        deliveryTime: step.deliveryTime ?? '09:00',
      },
      messageType: step.messageType,
      messageContent: step.messageContent,
      templateId: step.templateId ?? null,
      onReachTagId: step.onReachTagId ?? null,
      inputMode: step.templateId ? 'template' : 'direct',
    })
    setEditingStepId(step.id)
    // 編集はステップ行直下にインライン表示するので、上部の新規追加フォームは閉じる
    setShowStepForm(false)
    setStepError('')
  }

  const closeStepForm = () => {
    setShowStepForm(false)
    setEditingStepId(null)
    setStepError('')
  }

  const handleSaveStep = async () => {
    // 直接入力モード: messageContent 必須 + Flex/画像 は JSON parse 検証
    if (stepForm.inputMode === 'direct') {
      if (!stepForm.messageContent.trim()) {
        setStepError('メッセージ内容を入力してください')
        return
      }
      if (stepForm.messageType === 'flex' || stepForm.messageType === 'image') {
        try {
          JSON.parse(stepForm.messageContent)
        } catch {
          setStepError(
            stepForm.messageType === 'flex'
              ? 'Flex メッセージの JSON が不正です'
              : '画像メッセージの JSON が不正です',
          )
          return
        }
      }
    } else {
      if (!stepForm.templateId) {
        setStepError('テンプレートを選択してください')
        return
      }
    }
    setStepSaving(true)
    setStepError('')
    try {
      const schedulePayload = buildSchedulePayload(deliveryMode, stepForm.schedule)
      // テンプレモード保存時は、選択中テンプレ内容を scenario_steps の messageType /
      // messageContent にスナップショットコピーする。テンプレ削除時に resolveStepContent
      // がここから正しい内容にフォールバックできるため。
      let payloadMessageType: MessageType = stepForm.messageType
      let payloadMessageContent: string = stepForm.messageContent || ' '
      if (stepForm.inputMode === 'template' && stepForm.templateId) {
        const tpl = templates.find((t) => t.id === stepForm.templateId)
        if (tpl) {
          // messageType: テンプレが image/carousel のときは scenario_steps の CHECK に
          // ('text','image','flex') の制約があるため text/image/flex のみ許容。
          // carousel が来る可能性は低いが念のため text にフォールバック。
          payloadMessageType = (['text', 'image', 'flex'].includes(tpl.messageType)
            ? tpl.messageType
            : 'text') as MessageType
          payloadMessageContent = tpl.messageContent || ' '
        }
      }
      const payload = {
        stepOrder: stepForm.stepOrder,
        ...schedulePayload,
        messageType: payloadMessageType,
        messageContent: payloadMessageContent,
        templateId: stepForm.inputMode === 'template' ? stepForm.templateId : null,
        onReachTagId: stepForm.onReachTagId,
      }
      if (editingStepId) {
        const res = await api.scenarios.updateStep(id, editingStepId, payload)
        if (!res.success) {
          setStepError(res.error)
          return
        }
      } else {
        const res = await api.scenarios.addStep(id, payload)
        if (!res.success) {
          setStepError(res.error)
          return
        }
      }
      closeStepForm()
      loadScenario()
      reloadStats()
    } catch {
      setStepError('ステップの保存に失敗しました')
    } finally {
      setStepSaving(false)
    }
  }

  const handleDeleteStep = async (stepId: string) => {
    if (!confirm('このステップを削除してもよいですか？')) return
    try {
      await api.scenarios.deleteStep(id, stepId)
      if (editingStepId === stepId) closeStepForm()
      loadScenario()
    } catch {
      setError('ステップの削除に失敗しました')
    }
  }

  const handleMoveStep = async (stepId: string, direction: 'up' | 'down') => {
    if (!scenario) return
    const sorted = [...scenario.steps].sort((a, b) => a.stepOrder - b.stepOrder)
    const idx = sorted.findIndex((s) => s.id === stepId)
    const swap = direction === 'up' ? idx - 1 : idx + 1
    if (idx < 0 || swap < 0 || swap >= sorted.length) return
    const a = sorted[idx]
    const b = sorted[swap]
    try {
      await api.scenarios.reorderSteps(id, [
        { stepId: a.id, stepOrder: b.stepOrder },
        { stepId: b.id, stepOrder: a.stepOrder },
      ])
      loadScenario()
      // 到達率バッジは stepOrder ベースでマッチングするので、並び替え後は stats も再取得
      reloadStats()
    } catch {
      setError('並び替えに失敗しました')
    }
  }

  // 新規追加（上部）とステップ編集（行直下インライン）の両方で使うフォーム。
  // 同時に開くのは常に片方だけなので、state は stepForm を共有する。
  const renderStepForm = () => (
    <div className={`${editingStepId ? 'mt-3' : 'mb-6'} p-4 bg-canvas-sunken rounded-lg border border-hairline`}>
      <h4 className="text-sm font-medium text-ink-secondary mb-3">
        {editingStepId ? 'ステップを編集' : '新しいステップを追加'}
      </h4>
      <div className="space-y-3 max-w-lg">
        <div>
          <label className="block text-xs font-medium text-ink-secondary mb-1">ステップ順序</label>
          <input
            type="number"
            min={1}
            className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            value={stepForm.stepOrder}
            onChange={(e) => setStepForm({ ...stepForm, stepOrder: Number(e.target.value) })}
          />
        </div>
        <ScheduleInput
          mode={deliveryMode}
          value={stepForm.schedule}
          onChange={(schedule) => setStepForm({ ...stepForm, schedule })}
        />

        {/* 入力モード切替: 直接入力 / テンプレート参照 */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-ink-secondary">メッセージの指定方法</label>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={stepForm.inputMode === 'direct'}
                onChange={() => setStepForm({ ...stepForm, inputMode: 'direct', templateId: null })}
              />
              <span>直接入力</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={stepForm.inputMode === 'template'}
                onChange={() => setStepForm({ ...stepForm, inputMode: 'template' })}
              />
              <span>テンプレートを使う</span>
            </label>
          </div>
        </div>

        {stepForm.inputMode === 'template' && (
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1">テンプレート <span className="text-red-500">*</span></label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
              value={stepForm.templateId ?? ''}
              onChange={(e) => setStepForm({ ...stepForm, templateId: e.target.value || null })}
            >
              <option value="">-- 選択してください --</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.category ? ` (${t.category})` : ''}</option>
              ))}
            </select>
            <p className="text-xs text-amber-700 mt-1">
              ⓘ テンプレートが修正されると、このステップの内容も自動で同期されます
            </p>
          </div>
        )}

        {stepForm.inputMode === 'direct' && (
          <>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">メッセージタイプ</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                value={stepForm.messageType}
                onChange={(e) => setStepForm({ ...stepForm, messageType: e.target.value as MessageType })}
              >
                {messageTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">メッセージ内容 <span className="text-red-500">*</span></label>
              <textarea
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                rows={4}
                placeholder="メッセージ内容を入力..."
                value={stepForm.messageContent}
                onChange={(e) => setStepForm({ ...stepForm, messageContent: e.target.value })}
              />
            </div>
          </>
        )}

        {/* 到達時のアクション */}
        <div className="pt-3 border-t border-hairline space-y-2">
          <h4 className="text-xs font-semibold text-ink-secondary">到達時のアクション</h4>
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1">到達したらタグ付与</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
              value={stepForm.onReachTagId ?? ''}
              onChange={(e) => setStepForm({ ...stepForm, onReachTagId: e.target.value || null })}
            >
              <option value="">-- なし --</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <p className="text-xs text-ink-faint mt-0.5">
              このステップが配信完了したら、選んだタグを友だちに付与します
            </p>
          </div>
        </div>

        {stepError && <p className="text-xs text-red-600">{stepError}</p>}

        <div className="flex gap-2">
          <button
            onClick={handleSaveStep}
            disabled={stepSaving}
 className="bg-accent text-on-accent transition-colors hover:bg-accent-hover px-4 py-2 min-h-[44px] text-sm font-medium rounded-control disabled:opacity-50"
          >
            {stepSaving ? '保存中...' : editingStepId ? '更新' : '追加'}
          </button>
          <button
            onClick={closeStepForm}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-ink-secondary bg-canvas-sunken hover:bg-gray-200 rounded-lg transition-colors"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  )

  if (loading) {
    return (
      <div>
        <Header title="シナリオ詳細" />
        <div className="bg-canvas rounded-card border border-hairline p-8 animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/3" />
          <div className="h-4 bg-canvas-sunken rounded w-2/3" />
          <div className="h-4 bg-canvas-sunken rounded w-1/2" />
        </div>
      </div>
    )
  }

  if (!scenario) {
    return (
      <div>
        <Header title="シナリオ詳細" />
        <div className="bg-canvas rounded-card border border-hairline p-8 text-center">
          <p className="text-ink-faint">{error || 'シナリオが見つかりません'}</p>
          <Link href="/scenarios" className="text-sm text-green-600 hover:text-green-700 mt-4 inline-block">
            ← シナリオ一覧に戻る
          </Link>
        </div>
      </div>
    )
  }

  const sortedSteps = [...scenario.steps].sort((a, b) => a.stepOrder - b.stepOrder)

  /**
   * 隣り合う通の間で、いちばん人が減ったところ。
   *
   * 到達人数はステップごとに集計済みだったが、画面はそれを表の中でしか
   * 使っていなかった。「どこで読まれなくなるか」は1通ずつ見比べないと
   * 分からず、通数が増えるほど気づけない。差がいちばん大きい1か所を出す。
   *
   * 減っていない（増えている）ときは出さない。分岐で人が分かれた場合など、
   * 減少として読むと誤解になる。
   */
  const biggestDrop = (() => {
    const steps = stats?.steps ?? []
    if (steps.length < 2) return null
    let worst: { fromOrder: number; toOrder: number; lost: number; rate: number } | null = null
    for (let i = 0; i < steps.length - 1; i += 1) {
      const from = steps[i]
      const to = steps[i + 1]
      const lost = from.reachedCount - to.reachedCount
      if (lost <= 0 || from.reachedCount === 0) continue
      const rate = lost / from.reachedCount
      if (!worst || lost > worst.lost) {
        worst = { fromOrder: from.stepOrder, toOrder: to.stepOrder, lost, rate }
      }
    }
    return worst
  })()
  const modeBadge = modeBadgeStyle[deliveryMode]

  return (
    <div>
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
        <Link href="/scenarios" className="hover:underline">
          シナリオ配信
        </Link>
        <span className="mx-1.5">/</span>
        <span>{scenario.name}</span>
      </nav>

      <div data-design="Head">
        <Header
          title="シナリオ編集"
          description="配信のタイミングと内容を並べます。作成しただけでは配信されません。開始するには友だち追加時の配信やアクションから呼び出します。"
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
                title="一括テスト送信は準備中です"
                className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50"
              >
                一括テスト送信
              </button>
              <Link
                href="/scenarios"
                className="text-ink-secondary bg-canvas-sunken hover:bg-hairline rounded-control inline-flex min-h-[44px] items-center px-4 py-2 text-sm font-medium"
              >
                ← シナリオ一覧
              </Link>
            </div>
          }
        />
      </div>

      {/*
        同時購読の決まり。シナリオを組む前に知っておかないと設計を間違える。

        右で切り替えられる。これまでは文だけ置いて「許可しない」と書いて
        いたが、実際は列（allow_concurrent）で持っていて、作るときにしか
        決められなかった。読むだけの説明の隣に、それを決める場所が無い。
      */}
      <section className="bg-info-bg rounded-card mb-4 flex flex-wrap items-start gap-4 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-info text-sm font-semibold">同時に購読できるシナリオは 1つ</p>
          <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
            別のシナリオを開始すると、いま流れているシナリオは停止します。あとで戻すと、止まった続きから再開します。複数の流れを同時に届けたい場合は、1つのシナリオ内で分岐させてください。
          </p>
        </div>
        <div className="border-hairline bg-canvas rounded-control flex shrink-0 overflow-hidden border">
          {[
            { value: false, label: '重複を許可しない' },
            { value: true, label: '許可する' },
          ].map((opt) => {
            const on = (scenario.allowConcurrent ?? true) === opt.value
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => void handleConcurrentChange(opt.value)}
                aria-pressed={on}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  on ? 'bg-accent-soft text-accent' : 'text-ink-secondary hover:bg-canvas-sunken'
                }`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </section>

      {error && (
        <div className="mb-4 p-4 bg-danger-bg border border-danger-bg rounded-lg text-danger text-sm">
          {error}
        </div>
      )}

      {/*
        統計。設計は1行。カード4枚に散らすと、購読中と読了済と離脱地点を
        見比べるのに目が横に大きく動く。並べて読むものなので1本にまとめる。
      */}
      {stats && stats.enrolledTotal > 0 && (
        <div
          data-design="KPIs"
          className="bg-canvas rounded-card border-hairline mb-4 flex flex-wrap items-center gap-x-8 gap-y-3 border px-5 py-4"
        >
          <div>
            <p className="text-ink-faint text-xs">購読中</p>
            <p className="text-ink text-xl font-bold tabular-nums">
              {stats.activeNow.toLocaleString('ja-JP')}
              <span className="text-ink-faint ml-0.5 text-xs font-normal">人</span>
            </p>
          </div>
          <div className="border-hairline border-l pl-8">
            <p className="text-ink-faint text-xs">読了済</p>
            <p className="text-ink text-xl font-bold tabular-nums">
              {stats.completed.toLocaleString('ja-JP')}
              <span className="text-ink-faint ml-0.5 text-xs font-normal">人</span>
            </p>
          </div>
          <div className="border-hairline border-l pl-8">
            <p className="text-ink-faint text-xs">離脱が大きい地点</p>
            {biggestDrop ? (
              <p className="text-warning text-xl font-bold">
                {biggestDrop.fromOrder}通目 <span className="mx-1">→</span> {biggestDrop.toOrder}通目
              </p>
            ) : (
              <p className="text-ink-faint text-xl font-bold">—</p>
            )}
          </div>
          {biggestDrop && (
            <p className="text-warning ml-auto text-xs">
              ↘ {biggestDrop.fromOrder}通目で {biggestDrop.lost.toLocaleString('ja-JP')}人（
              {Math.round(biggestDrop.rate * 100)}%）が離脱しています
            </p>
          )}
        </div>
      )}

      {/* Scenario Info */}
      <div className="bg-canvas rounded-card border border-hairline p-6 mb-6">
        {editing ? (
          <div className="space-y-4 max-w-lg">
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">シナリオ名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">説明</label>
              <textarea
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                rows={2}
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">トリガー</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                value={editForm.triggerType}
                onChange={(e) => setEditForm({ ...editForm, triggerType: e.target.value as ScenarioTriggerType })}
              >
                {triggerOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="editIsActive"
                checked={editForm.isActive}
                onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
              />
              <label htmlFor="editIsActive" className="text-sm text-ink-secondary">有効</label>
            </div>
            <div className="border-hairline rounded-lg border p-3">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={!editForm.allowConcurrent}
                  onChange={(e) => setEditForm({ ...editForm, allowConcurrent: !e.target.checked })}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                />
                <span className="text-ink-secondary text-sm">
                  他のシナリオが動いている人は登録しない
                  <span className="text-ink-faint block text-xs leading-relaxed">
                    既定では、1人が複数のシナリオに同時に入れます。
                    ここをチェックすると、他のシナリオが動いている人はこのシナリオに入りません。
                    すでに入っている人には影響しません。
                  </span>
                </span>
              </label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSaveScenario}
                disabled={saving}
 className="bg-accent text-on-accent transition-colors hover:bg-accent-hover px-4 py-2 min-h-[44px] text-sm font-medium rounded-control disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
              <button
                onClick={() => {
                  setEditing(false)
                  setEditForm({
                    name: scenario.name,
                    description: scenario.description ?? '',
                    triggerType: scenario.triggerType,
                    isActive: scenario.isActive,
                    allowConcurrent: scenario.allowConcurrent !== false,
                  })
                }}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-ink-secondary bg-canvas-sunken hover:bg-gray-200 rounded-lg transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        ) : (
          <div>
            {/*
              設計は5枚の札を横に並べ、それぞれに直す入口を付ける。
              以前は名前と説明の下に定義リストを縦に置いていたが、
              どれが直せてどれが読むだけなのかが見分けられなかった。
            */}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <SettingCard label="シナリオ名" action="編集" onAction={() => setEditing(true)}>
                <p className="text-ink truncate text-sm font-bold">{scenario.name}</p>
                {/* シナリオにフォルダを持たせる列が無い。 */}
                <p className="text-ink-faint mt-0.5 text-xs">フォルダ：未分類</p>
              </SettingCard>

              <SettingCard label="配信方式">
                <p className="text-ink text-sm font-bold">{modeBadge.label}</p>
                <p className="text-ink-faint mt-0.5 text-xs">作ったあとは変えられません</p>
              </SettingCard>

              <SettingCard label="状態" action="変更" onAction={() => setEditing(true)}>
                <p className={`text-sm font-bold ${scenario.isActive ? 'text-ink' : 'text-warning'}`}>
                  {scenario.isActive ? '配信可' : '一時停止中'}
                </p>
                <p className="text-ink-faint mt-0.5 text-xs">
                  {scenario.isActive ? '配信を一時停止する' : '配信を再開する'}
                </p>
              </SettingCard>

              <SettingCard label="対象の絞り込み">
                {/* 購読を始める相手を絞る条件を持っていない。呼び出し側で
                    絞ってから開始する形になっている。 */}
                <p className="text-ink text-sm font-bold">
                  {triggerOptions.find((o) => o.value === scenario.triggerType)?.label ??
                    scenario.triggerType}
                </p>
                <p className="text-ink-faint mt-0.5 text-xs">条件は呼び出し側で決まります</p>
              </SettingCard>

              <SettingCard label="最終ステップ後の処理">
                {/* 読み終わったあと次のシナリオへ、という設定が無い。 */}
                <p className="text-ink text-sm font-bold">なし</p>
                <p className="text-ink-faint mt-0.5 text-xs">読了で終わり</p>
              </SettingCard>
            </div>

            {scenario.description && (
              <p className="text-ink-faint mt-3 text-sm">{scenario.description}</p>
            )}
          </div>
        )}
      </div>

      {/* Steps */}
      <div className="bg-canvas rounded-card border border-hairline p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-ink text-sm font-semibold">コンテンツ {sortedSteps.length} 通</h3>
          <div className="flex gap-2">
            <button
              onClick={() => setPreviewOpen(true)}
              disabled={sortedSteps.length === 0}
              className="px-3 py-1.5 min-h-[44px] text-sm font-medium text-ink-secondary bg-canvas-sunken hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-40"
            >
              一括プレビュー
            </button>
            <button
              onClick={openAddStep}
 className="bg-accent text-on-accent transition-colors hover:bg-accent-hover px-3 py-1.5 min-h-[44px] text-sm font-medium rounded-control"
            >
              + ステップ追加
            </button>
          </div>
        </div>

        {/* 新規ステップ追加フォーム（編集フォームは各ステップの行直下にインライン表示） */}
        {showStepForm && renderStepForm()}

        {/* Steps list */}
        {sortedSteps.length === 0 ? (
          <div className="text-center py-8 text-ink-faint text-sm">
            ステップがありません。「+ ステップ追加」から追加してください。
          </div>
        ) : (
          <div className="space-y-3">
            {sortedSteps.map((step, idx) => (
              <div
                key={step.id}
                className="border border-hairline rounded-lg p-4 hover:border-gray-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span
 className="bg-accent text-on-accent transition-colors hover:bg-accent-hover inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold shrink-0"
                      >
                        {step.stepOrder}
                      </span>
                      <span className="text-xs text-ink-faint">{formatScheduleLabel(deliveryMode, step)}</span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        step.messageType === 'text' ? 'bg-blue-50 text-blue-600' :
                        step.messageType === 'image' ? 'bg-purple-50 text-purple-600' :
                        'bg-orange-50 text-orange-600'
                      }`}>
                        {messageTypeOptions.find(o => o.value === step.messageType)?.label ?? step.messageType}
                      </span>
                      {(() => {
                        const stat = stats?.steps.find((s) => s.stepOrder === step.stepOrder)
                        return stat ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700">
                            📊 {stat.reachedCount}人到達 ({Math.round(stat.reachRate * 100)}%)
                          </span>
                        ) : null
                      })()}
                    </div>
                    {(() => {
                      // テンプレ参照時は、表示も「現在のテンプレ内容」を見せる。
                      // (templates state には list で取得済みの最新内容が入っている)
                      const tpl = step.templateId ? templates.find((t) => t.id === step.templateId) : null
                      const displayType = tpl ? tpl.messageType : step.messageType
                      const displayContent = tpl ? tpl.messageContent : step.messageContent
                      return (
                        <div className="text-sm text-ink-secondary bg-canvas-sunken rounded-md px-3 py-2">
                          {displayType === 'text' ? (
                            <p className="whitespace-pre-wrap break-words">{displayContent}</p>
                          ) : displayType === 'flex' ? (
                            <FlexPreview content={displayContent} />
                          ) : displayType === 'image' ? (
                            <ImagePreview content={displayContent} />
                          ) : (
                            <p className="whitespace-pre-wrap break-words">{displayContent}</p>
                          )}
                        </div>
                      )
                    })()}
                    {step.templateId && (
                      <p className="mt-2 text-xs text-amber-700">
                        📋 テンプレ: {templates.find((t) => t.id === step.templateId)?.name ?? step.templateId}
                      </p>
                    )}
                    {step.onReachTagId && (
                      <p className="mt-1 text-xs text-green-700">
                        🏷 到達タグ: {tags.find((t) => t.id === step.onReachTagId)?.name ?? step.onReachTagId}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-stretch gap-1 shrink-0">
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleMoveStep(step.id, 'up')}
                        disabled={idx === 0}
                        className="text-xs text-ink-faint hover:text-ink-secondary px-2 py-1 rounded hover:bg-canvas-sunken transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                        aria-label="上へ"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => handleMoveStep(step.id, 'down')}
                        disabled={idx === sortedSteps.length - 1}
                        className="text-xs text-ink-faint hover:text-ink-secondary px-2 py-1 rounded hover:bg-canvas-sunken transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                        aria-label="下へ"
                      >
                        ↓
                      </button>
                    </div>
                    <button
                      onClick={() => (editingStepId === step.id ? closeStepForm() : openEditStep(step))}
                      className="text-xs text-green-600 hover:text-green-700 px-2 py-1 rounded hover:bg-green-50 transition-colors"
                    >
                      {editingStepId === step.id ? '閉じる' : '編集'}
                    </button>
                    <button
                      onClick={() => handleDeleteStep(step.id)}
                      className="text-xs text-red-500 hover:text-danger px-2 py-1 rounded hover:bg-danger-bg transition-colors"
                    >
                      削除
                    </button>
                  </div>
                </div>
                {/* インライン編集フォーム: 編集対象ステップの行直下に展開 */}
                {editingStepId === step.id && renderStepForm()}
              </div>
            ))}
          </div>
        )}
      </div>

      <BulkPreviewModal
        open={previewOpen}
        scenarioId={id}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  )
}
