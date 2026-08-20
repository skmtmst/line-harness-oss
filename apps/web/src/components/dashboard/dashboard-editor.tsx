'use client'

import { useEffect, useState } from 'react'

export type DashboardCardId =
  | 'shipment'
  | 'pending-inbox'
  | 'friend-trend'
  | 'friend-add'
  | 'scenario-status'
  | 'uid-migration'
  | 'upcoming'
  | 'monthly-delivery'
  | 'recent-results'
  | 'booking-status'
  | 'inflow-top'
  | 'funnel-alert'
  | 'automation-failures'
  | 'friend-status'

export type DashboardGroup = 'main' | 'right'

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

export const DASHBOARD_CARD_DEFINITIONS: CardDefinition[] = [
  { id: 'shipment', label: '出荷予定', description: 'メイン｜横幅いっぱい', group: 'main', defaultVisible: true },
  { id: 'pending-inbox', label: '対応が必要な受信', description: '未対応のLINE・メール', group: 'main', defaultVisible: true },
  { id: 'friend-trend', label: '友だち数の推移', description: '登録・ブロック・有効数', group: 'main', defaultVisible: true },
  { id: 'friend-add', label: '友だち追加リンク', description: '追加URL・QRコード', group: 'main', defaultVisible: true },
  { id: 'scenario-status', label: 'シナリオ配信状況', description: 'メイン｜配信中・停止中', group: 'main', defaultVisible: false },
  { id: 'uid-migration', label: 'UID移行状況', description: 'メイン｜移行の進捗', group: 'main', defaultVisible: false },
  { id: 'upcoming', label: '今後の予定', description: '予約・配信の予定', group: 'right', defaultVisible: true },
  { id: 'monthly-delivery', label: '今月の配信', description: 'プッシュ・リプライ・残枠', group: 'right', defaultVisible: true },
  { id: 'recent-results', label: '最近の成果', description: 'コンバージョン', group: 'right', defaultVisible: true },
  { id: 'booking-status', label: '予約状況', description: '右サイド｜予約の内訳', group: 'right', defaultVisible: false },
  { id: 'inflow-top', label: '流入経路TOP3', description: '右サイド｜友だち追加経路', group: 'right', defaultVisible: false },
  { id: 'funnel-alert', label: 'ファネル要注意', description: '右サイド｜離脱の検知', group: 'right', defaultVisible: false },
  { id: 'automation-failures', label: 'オートメーション失敗', description: '右サイド｜失敗した処理', group: 'right', defaultVisible: false },
  { id: 'friend-status', label: '友だちの状態', description: '右サイド｜有効数・ブロック率', group: 'right', defaultVisible: false },
]

export function defaultDashboardPreferences(): DashboardPreferences {
  return {
    main: DASHBOARD_CARD_DEFINITIONS.filter((card) => card.group === 'main').map((card) => ({
      id: card.id,
      visible: card.defaultVisible,
    })),
    right: DASHBOARD_CARD_DEFINITIONS.filter((card) => card.group === 'right').map((card) => ({
      id: card.id,
      visible: card.defaultVisible,
    })),
  }
}

/**
 * 保存済み設定にあとから増えたカードを補い、知らないIDは捨てる。
 * 古いブラウザ設定が原因で新しいカードが編集画面から消えないようにする。
 */
export function normalizeDashboardPreferences(value: unknown): DashboardPreferences {
  const defaults = defaultDashboardPreferences()
  if (!value || typeof value !== 'object') return defaults
  const input = value as Partial<Record<DashboardGroup, unknown>>

  const normalizeGroup = (group: DashboardGroup): DashboardPreferenceItem[] => {
    const allowed = new Map(
      defaults[group].map((item) => [item.id, item] as const),
    )
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

  return { main: normalizeGroup('main'), right: normalizeGroup('right') }
}

function MoveIcon({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d={direction === 'up' ? 'M5.5 12.5 10 8l4.5 4.5' : 'M5.5 7.5 10 12l4.5-4.5'} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
    </svg>
  )
}

export default function DashboardEditor({
  open,
  preferences,
  onCancel,
  onApply,
}: {
  open: boolean
  preferences: DashboardPreferences
  onCancel: () => void
  onApply: (next: DashboardPreferences) => void
}) {
  const [draft, setDraft] = useState(preferences)

  useEffect(() => {
    if (open) setDraft(preferences)
  }, [open, preferences])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  if (!open) return null

  const toggle = (group: DashboardGroup, id: DashboardCardId) => {
    setDraft((current) => ({
      ...current,
      [group]: current[group].map((item) =>
        item.id === id ? { ...item, visible: !item.visible } : item,
      ),
    }))
  }

  const move = (group: DashboardGroup, index: number, offset: -1 | 1) => {
    setDraft((current) => {
      const target = index + offset
      if (target < 0 || target >= current[group].length) return current
      const items = [...current[group]]
      ;[items[index], items[target]] = [items[target], items[index]]
      return { ...current, [group]: items }
    })
  }

  return (
    <div data-design="Editor" className="bg-ink/25 fixed inset-0 z-50 flex justify-end" role="presentation" onMouseDown={onCancel}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-editor-title"
        className="bg-canvas flex h-full w-full max-w-[430px] flex-col shadow-[-8px_0_28px_rgba(26,28,26,0.14)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="border-hairline flex items-start justify-between gap-4 border-b px-6 py-5">
          <div>
            <h2 id="dashboard-editor-title" className="text-ink text-lg font-bold">ダッシュボード編集</h2>
            <p className="text-ink-faint mt-1 text-xs leading-relaxed">表示するカードと並び順を変更できます。</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="閉じる" className="text-ink-faint hover:text-ink rounded-control p-1.5">
            <CloseIcon />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {(['main', 'right'] as const).map((group) => (
            <section key={group}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h3 className="text-ink text-sm font-bold">{group === 'main' ? 'メイン' : '右サイド'}</h3>
                <span className="text-ink-faint text-[11px]">上から表示される順番</span>
              </div>
              <div className="border-hairline overflow-hidden rounded-card border">
                {draft[group].map((item, index) => {
                  const definition = DASHBOARD_CARD_DEFINITIONS.find((card) => card.id === item.id)
                  if (!definition) return null
                  const fixedPosition = item.id === 'shipment'
                  return (
                    <div key={item.id} className="border-hairline flex items-center gap-3 border-b px-3 py-3 last:border-b-0">
                      <div className="flex shrink-0 flex-col">
                        <button
                          type="button"
                          onClick={() => move(group, index, -1)}
                          disabled={fixedPosition || index === 0}
                          aria-label={`${definition.label}を上へ移動`}
                          className="text-ink-faint hover:text-ink disabled:opacity-20"
                        >
                          <MoveIcon direction="up" />
                        </button>
                        <button
                          type="button"
                          onClick={() => move(group, index, 1)}
                          disabled={fixedPosition || index === draft[group].length - 1}
                          aria-label={`${definition.label}を下へ移動`}
                          className="text-ink-faint hover:text-ink disabled:opacity-20"
                        >
                          <MoveIcon direction="down" />
                        </button>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-ink truncate text-sm font-medium" title={definition.label}>{definition.label}</p>
                        <p className="text-ink-faint truncate text-[11px]" title={definition.description}>{definition.description}</p>
                      </div>
                      <label className="relative inline-flex shrink-0 cursor-pointer items-center">
                        <input
                          type="checkbox"
                          checked={item.visible}
                          onChange={() => toggle(group, item.id)}
                          className="peer sr-only"
                          aria-label={`${definition.label}を${item.visible ? '非表示' : '表示'}にする`}
                        />
                        <span className="bg-hairline peer-checked:bg-accent h-6 w-11 rounded-pill transition-colors" />
                        <span className="bg-canvas absolute left-0.5 h-5 w-5 rounded-full shadow-sm transition-transform peer-checked:translate-x-5" />
                      </label>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>

        <footer className="border-hairline flex items-center justify-end gap-2 border-t px-6 py-4">
          <button type="button" onClick={onCancel} className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-4 py-2 text-sm font-medium">
            キャンセル
          </button>
          <button type="button" onClick={() => onApply(draft)} className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-5 py-2 text-sm font-medium">
            反映する
          </button>
        </footer>
      </aside>
    </div>
  )
}
