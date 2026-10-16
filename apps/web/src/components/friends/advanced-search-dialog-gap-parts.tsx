'use client'

import { useState } from 'react';
import type { SavedSearchCondition, Scenario } from '@line-crm/shared';
import DateField from '@/components/shared/date-field';
import { SaveErrorField } from '@/components/shared/save-form-errors';
import EntitySelect, { entityOptionMetadata } from '@/components/shared/entity-select';


/*
 * FRIEND-03: ORの軸は「項目→比較方法→値」を自分で選ぶ。
 * 先頭の候補や固定の日付を勝手に使うと、選んだ覚えのない条件で
 * 絞り込まれる。値が要る軸は入力が揃うまで「追加」を押せない。
 */
type OrAxisInput = 'mark' | 'scenario' | 'date' | 'text' | null

const OR_AXES: Array<{
  label: string
  feature?: 'support_marks'
  input: OrAxisInput
  placeholder?: string
  make: (value: string) => SavedSearchCondition | null
}> = [
  { label: '対応マーク', feature: 'support_marks', input: 'mark', make: (value) => value ? { kind: 'mark', op: 'eq', value } : null },
  { label: 'シナリオ', input: 'scenario', make: (value) => value ? { kind: 'scenario', op: 'eq', value } : null },
  { label: 'イベント予約', input: null, make: () => ({ kind: 'event_booking', op: 'exists' }) },
  { label: 'カレンダー予約', input: null, make: () => ({ kind: 'calendar_booking', op: 'exists' }) },
  { label: '回答フォーム', input: null, make: () => ({ kind: 'form', op: 'exists' }) },
  { label: '最終反応日', input: 'date', make: (value) => value ? { kind: 'last_activity', op: 'after', value } : null },
  { label: 'リマインダ', input: null, make: () => ({ kind: 'reminder', op: 'exists' }) },
  { label: 'メモ', input: null, make: () => ({ kind: 'memo', op: 'exists' }) },
  { label: 'ステータスメッセージ', input: 'text', placeholder: '含む文字', make: (value) => value.trim() ? { kind: 'status_message', op: 'contains', value: value.trim() } : null },
  { label: '友だち登録日', input: 'date', make: (value) => value ? { kind: 'created_at', op: 'after', value } : null },
  { label: 'その他', input: 'text', placeholder: 'イベント種別（例：conversion）', make: (value) => value.trim() ? { kind: 'common_event', op: 'exists', value: value.trim() } : null },
]


/**
 * ORの軸1つぶん。値が要る軸は入力が揃うまで追加できない（FRIEND-03）。
 * 先頭の候補・固定の日付を勝手に使うことはない。
 */
function OrAxisPicker({
  axis,
  marks,
  scenarios,
  onAdd,
}: {
  axis: (typeof OR_AXES)[number]
  marks: Array<{ id: string; name: string }>
  scenarios: Scenario[]
  onAdd: (condition: SavedSearchCondition) => void
}) {
  const [draft, setDraft] = useState('')
  const options = axis.input === 'mark' ? marks : axis.input === 'scenario' ? scenarios : []
  const waitingForOptions = (axis.input === 'mark' || axis.input === 'scenario') && options.length === 0
  const condition = axis.make(draft)
  const addable = !waitingForOptions && (axis.input === null || condition !== null)

  return (
    <div className="flex max-w-xs flex-col gap-1">
      <span className="text-xs font-semibold text-ink-secondary">{axis.label}</span>
      <div className="flex items-center gap-1.5">
        {axis.input === 'mark' || axis.input === 'scenario' ? (
          <SaveErrorField names={["draft"]}><EntitySelect clearable size="full"
            aria-label={`${axis.label}を選ぶ`}
            placeholder="選ぶ"
            value={draft}
            onChange={setDraft}
            disabled={waitingForOptions}
            options={options.map((option) => ({ ...entityOptionMetadata(option), value: option.id, label: option.name }))}
            className="min-w-0 flex-1"
          /></SaveErrorField>
        ) : axis.input === 'date' ? (
          <SaveErrorField names={["draft"]}><DateField
            value={draft}
            onChange={setDraft}
            aria-label={`${axis.label}の日付（この日以降）`}
            className="min-w-0 flex-1"
          /></SaveErrorField>
        ) : axis.input === 'text' ? (
          <SaveErrorField names={["draft"]}><input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={axis.placeholder}
            aria-label={`${axis.label}の値`}
            className="border-hairline rounded-control bg-canvas text-ink min-w-0 flex-1 border px-2 py-1.5 text-xs"
          /></SaveErrorField>
        ) : null}
        <button
          type="button"
          disabled={!addable}
          onClick={() => {
            if (!condition) return
            onAdd(condition)
            setDraft('')
          }}
          className="shrink-0 rounded-pill border border-divider-soft bg-canvas-sunken px-3 py-1.5 text-xs text-ink-secondary disabled:opacity-50"
        >
          ＋ 追加する
        </button>
      </div>
      {waitingForOptions ? <span className="text-ink-faint text-nano leading-tight">選択肢を読み込むと使えます</span> : null}
      {axis.input === 'date' ? <span className="text-ink-faint text-nano leading-tight">指定した日以降</span> : null}
    </div>
  )
}
export { type OrAxisInput, OR_AXES, OrAxisPicker }
