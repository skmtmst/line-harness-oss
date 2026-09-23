'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
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
import {
  DASHBOARD_CARD_GROUPS,
  DASHBOARD_TODAY_VISIBLE_LIMIT,
  type DashboardCardGroup,
  type DashboardCardId,
} from '@line-crm/shared'
import Button from '@/components/shared/button'
import { useOverlayFocus } from '@/components/shared/overlay-utils'

/*
 * カードIDと区分の正本は @line-crm/shared の DASHBOARD_CARD_GROUPS。
 * 保存APIも同じ一覧で検証するため、ここだけ変えると画面が送るIDを
 * APIが拒否する（DASH-01の再来になる）。名前・説明・既定ON/OFFだけを
 * ここで持ち、IDと区分は共有定義から組み立てる。
 */
export type { DashboardCardId }
export type DashboardGroup = DashboardCardGroup

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

export const TODAY_TASK_LIMIT = DASHBOARD_TODAY_VISIBLE_LIMIT

/** カードの名前・説明・既定ON/OFF。キーは共有定義のIDと完全一致する（型で強制）。 */
const CARD_META: Record<DashboardCardId, { label: string; description: string; defaultVisible: boolean }> = {
  'today-inbox': { label: '対応が必要な受信', description: '上部・小カード', defaultVisible: true },
  'today-photo-review': { label: '写真審査', description: '上部・小カード', defaultVisible: true },
  'today-bookings': { label: '今日の予約', description: '上部・小カード', defaultVisible: true },
  'today-shipments': { label: '出荷予定件数', description: '上部・小カード', defaultVisible: true },
  'shipment': { label: '出荷予定', description: 'メイン・横長', defaultVisible: true },
  'pending-inbox': { label: '対応が必要な受信一覧', description: 'メイン・横長', defaultVisible: true },
  'friend-trend': { label: '友だち数の推移', description: 'メイン・横長', defaultVisible: true },
  'friend-add': { label: '友だち追加リンク', description: 'メイン・左カラム', defaultVisible: true },
  'scenario-status': { label: 'シナリオ配信状況', description: 'メイン｜配信中・停止中', defaultVisible: false },
  'uid-migration': { label: 'UID移行状況', description: 'メイン｜移行の進捗', defaultVisible: false },
  'send-quota': { label: '今月の送信枠', description: '右サイド', defaultVisible: true },
  'operational-alerts': { label: '運用アラート', description: '右サイド', defaultVisible: true },
  'connection-status': { label: '接続状態', description: '右サイド', defaultVisible: true },
  'support-mark-status': { label: '現在の対応状況', description: '右サイド', defaultVisible: true },
  'friend-status': { label: '友だちの状態', description: '右サイド｜有効数・ブロック率', defaultVisible: false },
  /* カードの実表題は「今後の予約」。載せるのは予約だけなので、編集パネルの名前も揃える（DASH-10）。 */
  'upcoming': { label: '今後の予約', description: '右サイド', defaultVisible: true },
  'monthly-delivery': { label: '今月の配信', description: '右サイド', defaultVisible: true },
  'recent-results': { label: '最近の成果', description: '右サイド', defaultVisible: true },
  'booking-status': { label: '予約状況', description: '右サイド｜本日・変更・キャンセル', defaultVisible: false },
  'inflow-top': { label: '流入経路TOP3', description: '右サイド｜直近7日の上位経路', defaultVisible: false },
  'funnel-alert': { label: 'ファネル要注意', description: '右サイド｜離脱率が基準超過時', defaultVisible: false },
  'automation-failures': { label: 'オートメーション失敗', description: '右サイド｜失敗した処理', defaultVisible: false },
}

export const DASHBOARD_CARD_DEFINITIONS: CardDefinition[] = (
  Object.keys(DASHBOARD_CARD_GROUPS) as DashboardGroup[]
).flatMap((group) =>
  DASHBOARD_CARD_GROUPS[group].map((id) => ({ id, group, ...CARD_META[id] })),
)

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
  return <div className={`rounded-lg border px-2 py-2 text-[10px] font-medium ${muted ? 'border-dashed border-hairline text-ink-faint' : 'border-hairline bg-canvas text-ink shadow-card'}`}>{children}</div>
}

/*
 * プレビューは実画面と同じ配置モデル（draftの3区分の並び）を使う（DASH-06）。
 * PCは「今日やること」4列＋メイン/右の左右分割、スマホは1列積みで、
 * 実画面の390pxの見え方（先頭2件＋折りたたみ）に合わせる。
 */
function DashboardPreview({ draft }: { draft: DashboardPreferences }) {
  const [device, setDevice] = useState<'pc' | 'mobile'>('pc')
  const visible = (group: DashboardGroup) => draft[group].filter((item) => item.visible)
  const label = (id: DashboardCardId) => CARD_DEFINITION_MAP.get(id)?.label ?? id
  const visibleCount = DASHBOARD_GROUPS.reduce((count, group) => count + visible(group).length, 0)
  const todayVisible = visible('today')
  // 実画面の390pxでは KpiCollapse が先頭2件だけを出し、残りは「集計を見る」で開く。
  const mobileTodayShown = todayVisible.slice(0, 2)
  const mobileTodayCollapsed = todayVisible.length - mobileTodayShown.length
  return (
    <div className="border-hairline bg-canvas-sunken rounded-card border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-ink-faint text-[11px]">実際のダッシュボードと同じ順番で表示します。</p>
        <div className="flex gap-1" role="tablist" aria-label="プレビューの画面幅">
          {([['pc', 'PC'], ['mobile', 'スマホ']] as const).map(([key, text]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={device === key}
              onClick={() => setDevice(key)}
              className={`rounded-pill border px-2.5 py-1 text-[10px] font-medium ${device === key ? 'border-accent bg-accent text-on-accent' : 'border-hairline bg-canvas text-ink-secondary'}`}
            >{text}</button>
          ))}
        </div>
      </div>
      {device === 'pc' ? (
        <>
          <div className="grid grid-cols-4 gap-1.5">
            {todayVisible.map((item) => <PreviewCard key={item.id}>{label(item.id)}</PreviewCard>)}
          </div>
          <div className="mt-2 grid grid-cols-[minmax(0,3fr)_minmax(76px,1fr)] gap-2">
            <div className="space-y-1.5">{visible('main').map((item) => <PreviewCard key={item.id}>{label(item.id)}</PreviewCard>)}</div>
            <div className="space-y-1.5">{visible('right').map((item) => <PreviewCard key={item.id}>{label(item.id)}</PreviewCard>)}</div>
          </div>
        </>
      ) : (
        <div className="space-y-1.5">
          {mobileTodayShown.map((item) => <PreviewCard key={item.id}>{label(item.id)}</PreviewCard>)}
          {mobileTodayCollapsed > 0 ? (
            <PreviewCard muted>ほか {mobileTodayCollapsed}件（「集計を見る」で開きます）</PreviewCard>
          ) : null}
          {visible('main').map((item) => <PreviewCard key={item.id}>{label(item.id)}</PreviewCard>)}
          {visible('right').map((item) => <PreviewCard key={item.id}>{label(item.id)}</PreviewCard>)}
        </div>
      )}
      {visibleCount === 0 ? <PreviewCard muted>表示するカードがありません</PreviewCard> : null}
    </div>
  )
}

function groupLabel(group: DashboardGroup): string {
  if (group === 'today') return '今日やること'
  if (group === 'main') return 'メイン'
  return '右サイド'
}

export default function DashboardEditor({ open, preferences, saving = false, saveError, saveConflict, onReloadPreferences, onCancel, onApply, onReset }: {
  open: boolean
  preferences: DashboardPreferences
  saving?: boolean
  /*
   * 保存・初期化の失敗はパネルの中へ出す（DASH-05）。背景の画面エラーと
   * 分離し、入力を消さずにその場で再試行できるようにする。
   */
  saveError?: string | null
  /** 409のとき true。「最新の配置を読み込む」導線を出す。 */
  saveConflict?: boolean
  /** 最新の配置を読み直し、成功したらその配置を返す（draftの新しい起点）。 */
  onReloadPreferences?: () => Promise<DashboardPreferences | null>
  onCancel: () => void
  onApply: (next: DashboardPreferences) => void
  onReset?: () => void
}) {
  const [draft, setDraft] = useState(preferences)
  const [mode, setMode] = useState<'cards' | 'preview'>('cards')
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [reloading, setReloading] = useState(false)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  /*
   * 編集中のdraftはパネルを開いた時点の配置で固定する（DASH-15）。
   * 開いている間に遅れて届いた配置GETや別経路の保存結果で
   * preferences が更新されても、利用者が直した途中の内容を黙って
   * 上書きしない。新しい配置は保存競合（409）として通知する。
   */
  const preferencesRef = useRef(preferences)
  preferencesRef.current = preferences
  useEffect(() => {
    if (open) {
      setDraft(preferencesRef.current)
      setMode('cards')
      setConfirmingReset(false)
    }
  }, [open])

  const reloadLatest = async () => {
    if (!onReloadPreferences) return
    setReloading(true)
    try {
      const latest = await onReloadPreferences()
      if (latest) setDraft(latest)
    } finally {
      setReloading(false)
    }
  }

  // Escape・Tabの循環・背景スクロール停止・閉じたあとのフォーカス戻しは
  // 共通のoverlay作法に揃える。保存中は確定途中の内容を失わないよう閉じない。
  const panelRef = useOverlayFocus(open, onCancel, saving)

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
    <div data-design="Editor" className="bg-ink/30 fixed inset-0 z-50 flex justify-end" role="presentation" onMouseDown={() => { if (!saving) onCancel() }}>
      <aside ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="dashboard-editor-title" className="bg-canvas flex h-full w-full max-w-[540px] flex-col shadow-float" onMouseDown={(event) => event.stopPropagation()}>
        <header className="border-hairline border-b px-[22px] pb-4 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="dashboard-editor-title" className="text-ink text-lg font-bold">ダッシュボード編集</h2>
              <p className="text-ink-faint mt-1 text-xs leading-relaxed">表示するカードと位置を変更します</p>
            </div>
            <button type="button" onClick={onCancel} disabled={saving} aria-label="閉じる" className="text-ink-faint hover:text-ink rounded-control p-1.5"><CloseIcon /></button>
          </div>
          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-ink-secondary text-xs">持ち手をドラッグして移動。スイッチで表示を切り替えます。</p>
            {/*
              「初期状態に戻す」は個人配置の削除なので、パネル内の確認を
              挟んでから実行する（A01-02）。1回目のクリックは確認を出すだけで、
              キャンセルすれば配置も編集中の内容も変わらない。
            */}
            <button
              type="button"
              disabled={saving}
              onClick={() => onReset ? setConfirmingReset(true) : setDraft(defaultDashboardPreferences())}
              className="text-action shrink-0 text-xs font-medium hover:underline"
            >初期状態に戻す</button>
          </div>
          {confirmingReset ? (
            <div role="alert" className="bg-status-warn-soft text-status-warn-deep mt-2 rounded-control px-3 py-2.5 text-xs leading-relaxed">
              <p className="font-semibold">現在の配置を削除して初期状態へ戻します</p>
              <p className="mt-1">この操作はすぐに保存され、あとからキャンセルしても元には戻りません。</p>
              <div className="mt-2 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => { setConfirmingReset(false); onReset?.() }}
                  className="text-status-warn-deep font-semibold underline"
                >削除して初期状態へ戻す</button>
                <button
                  type="button"
                  onClick={() => setConfirmingReset(false)}
                  className="font-medium underline"
                >やめる</button>
              </div>
            </div>
          ) : null}
          <div className="mt-3 flex gap-2" role="tablist" aria-label="ダッシュボード編集モード">
            <Button role="tab" aria-selected={mode === 'cards'} onClick={() => setMode('cards')} variant={mode === 'cards' ? 'primary' : 'secondary'}>カードと配置</Button>
            <Button role="tab" aria-selected={mode === 'preview'} onClick={() => setMode('preview')} variant={mode === 'preview' ? 'primary' : 'secondary'}>プレビュー</Button>
          </div>
        </header>

        {/*
          配置の保存・初期化の失敗はこのパネルの上部へ出す（DASH-05）。
          再試行は「意図した配置操作」だけを実行し、概要の再取得はしない。
        */}
        {saveError ? (
          <div role="alert" className="bg-danger-bg text-danger mx-[22px] mt-3 rounded-control px-3 py-2.5 text-xs leading-relaxed">
            <p className="font-medium">{saveError}</p>
            <div className="mt-1.5 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => onApply(draft)}
                className="font-medium underline"
              >もう一度保存する</button>
              {saveConflict && onReloadPreferences ? (
                <button
                  type="button"
                  disabled={saving || reloading}
                  onClick={() => void reloadLatest()}
                  className="font-medium underline"
                >{reloading ? '読み込み中…' : '最新の配置を読み込む'}</button>
              ) : null}
            </div>
          </div>
        ) : null}

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
          <Button onClick={onCancel} disabled={saving}>キャンセル</Button>
          <Button onClick={() => onApply(draft)} disabled={saving} aria-busy={saving} variant="primary">{saving ? '保存中…' : 'ダッシュボードに反映'}</Button>
        </footer>
      </aside>
    </div>
  )
}
