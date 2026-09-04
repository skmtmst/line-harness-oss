'use client'

import { useEffect, useState, type ReactNode } from 'react'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export type DashboardCardId =
  | 'today-inbox'
  | 'today-photo-review'
  | 'today-bookings'
  | 'today-shipments'
  | 'shipment'
  | 'pending-inbox'
  | 'friend-trend'
  | 'friend-add'
  | 'scenario-status'
  | 'uid-migration'
  | 'send-quota'
  | 'operational-alerts'
  | 'connection-status'
  | 'upcoming'
  | 'monthly-delivery'
  | 'recent-results'
  | 'booking-status'
  | 'inflow-top'
  | 'funnel-alert'
  | 'automation-failures'
  | 'support-mark-status'
  | 'friend-status'

export type DashboardGroup = 'today' | 'main' | 'right'

export type DashboardPreferenceItem = {
  id: DashboardCardId
  visible: boolean
}

export type DashboardPreferences = Record<DashboardGroup, DashboardPreferenceItem[]>

type CardDefinition = {
  id: DashboardCardId
  label: string
  description: string
  group: DashboardGroup
  defaultVisible: boolean
}

export const TODAY_TASK_LIMIT = 4

export const DASHBOARD_CARD_DEFINITIONS: CardDefinition[] = [
  { id: 'today-inbox', label: '対応が必要な受信', description: '上部・小カード', group: 'today', defaultVisible: true },
  { id: 'today-photo-review', label: '写真審査', description: '上部・小カード', group: 'today', defaultVisible: true },
  { id: 'today-bookings', label: '今日の予約', description: '上部・小カード', group: 'today', defaultVisible: true },
  { id: 'today-shipments', label: '出荷予定件数', description: '上部・小カード', group: 'today', defaultVisible: true },
  { id: 'shipment', label: '出荷予定', description: 'メイン・横長', group: 'main', defaultVisible: true },
  { id: 'pending-inbox', label: '対応が必要な受信一覧', description: 'メイン・横長', group: 'main', defaultVisible: true },
  { id: 'friend-trend', label: '友だち数の推移', description: 'メイン・横長', group: 'main', defaultVisible: true },
  { id: 'friend-add', label: '友だち追加リンク', description: 'メイン・左カラム', group: 'main', defaultVisible: true },
  { id: 'scenario-status', label: 'シナリオ配信状況', description: 'メイン｜配信中・停止中', group: 'main', defaultVisible: false },
  { id: 'uid-migration', label: 'UID移行状況', description: 'メイン｜移行の進捗', group: 'main', defaultVisible: false },
  { id: 'send-quota', label: '今月の送信枠', description: '右サイド', group: 'right', defaultVisible: true },
  { id: 'operational-alerts', label: '運用アラート', description: '右サイド', group: 'right', defaultVisible: true },
  { id: 'connection-status', label: '接続状態', description: '右サイド', group: 'right', defaultVisible: true },
  { id: 'support-mark-status', label: '現在の対応状況', description: '右サイド', group: 'right', defaultVisible: true },
  { id: 'friend-status', label: '友だちの状態', description: '右サイド｜有効数・ブロック率', group: 'right', defaultVisible: false },
  { id: 'upcoming', label: '今後の予定', description: '右サイド', group: 'right', defaultVisible: true },
  { id: 'monthly-delivery', label: '今月の配信', description: '右サイド', group: 'right', defaultVisible: true },
  { id: 'recent-results', label: '最近の成果', description: '右サイド', group: 'right', defaultVisible: true },
  { id: 'booking-status', label: '予約状況', description: '右サイド｜本日・変更・キャンセル', group: 'right', defaultVisible: false },
  { id: 'inflow-top', label: '流入経路TOP3', description: '右サイド｜直近7日の上位経路', group: 'right', defaultVisible: false },
  { id: 'funnel-alert', label: 'ファネル要注意', description: '右サイド｜離脱率が基準超過時', group: 'right', defaultVisible: false },
  { id: 'automation-failures', label: 'オートメーション失敗', description: '右サイド｜失敗した処理', group: 'right', defaultVisible: false },
]

const CARD_DEFINITION_MAP = new Map(DASHBOARD_CARD_DEFINITIONS.map((card) => [card.id, card]))
const DASHBOARD_GROUPS: DashboardGroup[] = ['today', 'main', 'right']

export function defaultDashboardPreferences(): DashboardPreferences {
  return {
    today: DASHBOARD_CARD_DEFINITIONS.filter((card) => card.group === 'today').map((card) => ({ id: card.id, visible: card.defaultVisible })),
    main: DASHBOARD_CARD_DEFINITIONS.filter((card) => card.group === 'main').map((card) => ({ id: card.id, visible: card.defaultVisible })),
    right: DASHBOARD_CARD_DEFINITIONS.filter((card) => card.group === 'right').map((card) => ({ id: card.id, visible: card.defaultVisible })),
  }
}

/** 保存済み設定へ追加カードを補い、知らないIDと重複を取り除く。 */
export function normalizeDashboardPreferences(value: unknown): DashboardPreferences {
  const defaults = defaultDashboardPreferences()
  if (!value || typeof value !== 'object') return defaults
  const input = value as Partial<Record<DashboardGroup, unknown>>

  const normalizeGroup = (group: DashboardGroup): DashboardPreferenceItem[] => {
    const allowed = new Map(defaults[group].map((item) => [item.id, item] as const))
    const normalized: DashboardPreferenceItem[] = []
    if (Array.isArray(input[group])) {
      for (const candidate of input[group]) {
        if (!candidate || typeof candidate !== 'object') continue
        const item = candidate as Partial<DashboardPreferenceItem>
        if (!item.id || !allowed.has(item.id) || normalized.some((entry) => entry.id === item.id)) continue
        normalized.push({ id: item.id, visible: item.visible !== false })
      }
    }
    for (const item of defaults[group]) {
      if (!normalized.some((entry) => entry.id === item.id)) normalized.push(item)
    }
    return normalized
  }

  return {
    today: normalizeGroup('today'),
    main: normalizeGroup('main'),
    right: normalizeGroup('right'),
  }
}

export function reorderDashboardItems(
  items: DashboardPreferenceItem[],
  activeId: DashboardCardId,
  overId: DashboardCardId,
): DashboardPreferenceItem[] {
  const oldIndex = items.findIndex((item) => item.id === activeId)
  const newIndex = items.findIndex((item) => item.id === overId)
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return items
  return arrayMove(items, oldIndex, newIndex)
}

/** 「今日やること」の5枚目をONにしたとき、並びのいちばん下を自動でOFFにする。 */
export function toggleDashboardItem(
  items: DashboardPreferenceItem[],
  id: DashboardCardId,
  limit?: number,
): DashboardPreferenceItem[] {
  const target = items.find((item) => item.id === id)
  if (!target) return items

  const toggled = items.map((item) => item.id === id ? { ...item, visible: !item.visible } : item)
  if (target.visible || limit === undefined) return toggled
  if (toggled.filter((item) => item.visible).length <= limit) return toggled

  const lowestVisible = toggled.findLast((item) => item.visible)
  return lowestVisible
    ? toggled.map((item) => item.id === lowestVisible.id ? { ...item, visible: false } : item)
    : toggled
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
    </svg>
  )
}

function GripIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18" className="h-[18px] w-[18px]" fill="currentColor">
      <circle cx="6" cy="4" r="1.1" /><circle cx="12" cy="4" r="1.1" />
      <circle cx="6" cy="9" r="1.1" /><circle cx="12" cy="9" r="1.1" />
      <circle cx="6" cy="14" r="1.1" /><circle cx="12" cy="14" r="1.1" />
    </svg>
  )
}

function SortableCardRow({ item, definition, onToggle }: {
  item: DashboardPreferenceItem
  definition: CardDefinition
  onToggle: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div ref={setNodeRef} style={style} className={`border-hairline flex h-[54px] items-center gap-2.5 border-b px-3 last:border-b-0 ${isDragging ? 'bg-action-soft relative z-10 shadow-md' : 'bg-canvas'}`}>
      <button type="button" aria-label={`${definition.label}をドラッグして並べ替え`} className="text-ink-faint hover:text-ink touch-none cursor-grab rounded p-0.5 active:cursor-grabbing" {...attributes} {...listeners}>
        <GripIcon />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-ink truncate text-sm font-medium" title={definition.label}>{definition.label}</p>
        <p className="text-ink-faint truncate text-[11px]" title={definition.description}>{definition.description}</p>
      </div>
      <label className="relative inline-flex shrink-0 cursor-pointer items-center">
        <input type="checkbox" checked={item.visible} onChange={onToggle} className="peer sr-only" aria-label={`${definition.label}を${item.visible ? '非表示' : '表示'}にする`} />
        <span className="bg-hairline peer-checked:bg-accent h-6 w-[42px] rounded-pill transition-colors" />
        <span className="bg-canvas absolute left-0.5 h-5 w-5 rounded-full shadow-sm transition-transform peer-checked:translate-x-[18px]" />
      </label>
    </div>
  )
}

function PreviewCard({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <div className={`rounded-lg border px-2 py-2 text-[10px] font-medium ${muted ? 'border-dashed border-hairline text-ink-faint' : 'border-hairline bg-canvas text-ink shadow-[1px_1px_2px_rgba(29,29,31,0.10)]'}`}>{children}</div>
}

function DashboardPreview({ draft }: { draft: DashboardPreferences }) {
  const visible = (group: DashboardGroup) => draft[group].filter((item) => item.visible)
  const label = (id: DashboardCardId) => CARD_DEFINITION_MAP.get(id)?.label ?? id
  const visibleCount = DASHBOARD_GROUPS.reduce((count, group) => count + visible(group).length, 0)
  return (
    <div className="border-hairline bg-canvas-sunken rounded-card border p-3">
      <p className="text-ink-faint mb-2 text-[11px]">実際のダッシュボードと同じ順番で表示します。</p>
      <div className="grid grid-cols-4 gap-1.5">
        {visible('today').map((item) => <PreviewCard key={item.id}>{label(item.id)}</PreviewCard>)}
      </div>
      <div className="mt-2 grid grid-cols-[minmax(0,3fr)_minmax(76px,1fr)] gap-2">
        <div className="space-y-1.5">{visible('main').map((item) => <PreviewCard key={item.id}>{label(item.id)}</PreviewCard>)}</div>
        <div className="space-y-1.5">{visible('right').map((item) => <PreviewCard key={item.id}>{label(item.id)}</PreviewCard>)}</div>
      </div>
      {visibleCount === 0 ? <PreviewCard muted>表示するカードがありません</PreviewCard> : null}
    </div>
  )
}

function groupLabel(group: DashboardGroup): string {
  if (group === 'today') return '今日やること'
  if (group === 'main') return 'メイン'
  return '右サイド'
}

export default function DashboardEditor({ open, preferences, onCancel, onApply, onReset }: {
  open: boolean
  preferences: DashboardPreferences
  onCancel: () => void
  onApply: (next: DashboardPreferences) => void
  onReset?: () => void
}) {
  const [draft, setDraft] = useState(preferences)
  const [mode, setMode] = useState<'cards' | 'preview'>('cards')
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  useEffect(() => {
    if (open) {
      setDraft(preferences)
      setMode('cards')
    }
  }, [open, preferences])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  if (!open) return null

  const toggle = (group: DashboardGroup, id: DashboardCardId) => {
    setDraft((current) => ({
      ...current,
      [group]: toggleDashboardItem(current[group], id, group === 'today' ? TODAY_TASK_LIMIT : undefined),
    }))
  }

  const handleDragEnd = (group: DashboardGroup, event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setDraft((current) => ({
      ...current,
      [group]: reorderDashboardItems(current[group], active.id as DashboardCardId, over.id as DashboardCardId),
    }))
  }

  return (
    <div data-design="Editor" className="bg-ink/25 fixed inset-0 z-50 flex justify-end" role="presentation" onMouseDown={onCancel}>
      <aside role="dialog" aria-modal="true" aria-labelledby="dashboard-editor-title" className="bg-canvas flex h-full w-full max-w-[540px] flex-col shadow-[-8px_0_28px_rgba(26,28,26,0.14)]" onMouseDown={(event) => event.stopPropagation()}>
        <header className="border-hairline border-b px-[22px] pb-4 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="dashboard-editor-title" className="text-ink text-lg font-bold">ダッシュボード編集</h2>
              <p className="text-ink-faint mt-1 text-xs leading-relaxed">表示するカードと位置を変更します</p>
            </div>
            <button type="button" onClick={onCancel} aria-label="閉じる" className="text-ink-faint hover:text-ink rounded-control p-1.5"><CloseIcon /></button>
          </div>
          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-ink-secondary text-xs">持ち手をドラッグして移動。スイッチで表示を切り替えます。</p>
            <button type="button" onClick={() => onReset ? onReset() : setDraft(defaultDashboardPreferences())} className="text-action shrink-0 text-xs font-medium hover:underline">初期状態に戻す</button>
          </div>
          <div className="mt-3 flex gap-2" role="tablist" aria-label="ダッシュボード編集モード">
            <button type="button" role="tab" aria-selected={mode === 'cards'} onClick={() => setMode('cards')} className={`rounded-control px-3 py-2 text-sm font-semibold ${mode === 'cards' ? 'bg-accent-deep text-on-accent' : 'border-hairline text-ink-secondary border hover:bg-canvas-sunken'}`}>カードと配置</button>
            <button type="button" role="tab" aria-selected={mode === 'preview'} onClick={() => setMode('preview')} className={`rounded-control px-3 py-2 text-sm font-semibold ${mode === 'preview' ? 'bg-accent-deep text-on-accent' : 'border-hairline text-ink-secondary border hover:bg-canvas-sunken'}`}>プレビュー</button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-[22px] py-5">
          {mode === 'preview' ? <DashboardPreview draft={draft} /> : (
            <div className="space-y-6">
              {DASHBOARD_GROUPS.map((group) => (
                <section key={group}>
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <h3 className="text-ink text-sm font-bold">{groupLabel(group)}</h3>
                    {/*
                      **上限と操作は別の話なので、1行にまとめない。**
                      設計 `ZN0ov` は「「今日やること」は4枠までです」を独立した1行で出す。
                      繋げると、上限の文と操作の案内が1つの札に見える。
                    */}
                    <span className="text-ink-faint text-[11px]">ドラッグで順番変更</span>
                  </div>
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => handleDragEnd(group, event)}>
                    <SortableContext items={draft[group].map((item) => item.id)} strategy={verticalListSortingStrategy}>
                      <div className="border-hairline overflow-hidden rounded-[9px] border">
                        {draft[group].map((item) => {
                          const definition = CARD_DEFINITION_MAP.get(item.id)
                          if (!definition) return null
                          return <SortableCardRow key={item.id} item={item} definition={definition} onToggle={() => toggle(group, item.id)} />
                        })}
                      </div>
                    </SortableContext>
                  </DndContext>
                  {group === 'today' ? (
                    <div className="bg-status-warn-soft text-status-warn-deep mt-3 rounded-control px-3 py-2.5 text-xs leading-relaxed">
                      <p className="font-semibold">「今日やること」は4枠までです</p>
                      <p className="mt-1">5つ目をONにすると、いちばん下のカードが自動でOFFになります。順番を入れ替えて、先に出したい4つを上に置いてください。</p>
                    </div>
                  ) : null}
                </section>
              ))}
            </div>
          )}
        </div>

        <footer className="border-hairline flex items-center justify-center gap-2 border-t px-[22px] py-4">
          <button type="button" onClick={onCancel} className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-4 py-2 text-sm font-medium">キャンセル</button>
          <button type="button" onClick={() => onApply(draft)} className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-5 py-2 text-sm font-medium">ダッシュボードに反映</button>
        </footer>
      </aside>
    </div>
  )
}
