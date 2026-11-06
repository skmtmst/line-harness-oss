'use client'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import ActionList, { type ActionChoice } from './action-list'

type FixedAction = FixedActionOption & { chosenId?: string }
export type FixedActionOption = {
  id: string
  label: string
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  onSelect?: (id: string) => void
  summary?: string
  icon?: LucideIcon
  editor?: ReactNode
  disabled?: boolean
  disabledReason?: string
  picker?: Omit<NonNullable<ActionChoice<FixedAction>['picker']>, 'apply'>
}

/** 固定の保存項目を、行うことの正の部品へ渡す。保存の種類・順序を増やさない。 */
export default function FixedActionList({ options, readOnly = false }: { options: FixedActionOption[]; readOnly?: boolean }) {
  return <ActionList<FixedAction>
    value={options.filter(option => option.enabled)}
    onChange={next => {
      if (readOnly) return
      for (const option of options) {
        const item = next.find(item => item.id === option.id)
        if (Boolean(item) !== option.enabled) option.onEnabledChange(Boolean(item))
        if (item?.chosenId !== undefined) option.onSelect?.(item.chosenId)
      }
    }}
    choices={options.filter(option => !option.enabled).map(option => ({
      id: option.id, label: option.label, icon: option.icon,
      disabled: option.disabled, disabledReason: option.disabledReason,
      make: () => ({ ...option, enabled: true }),
      picker: option.picker ? { ...option.picker, apply: (item, ids) => ({ ...item, chosenId: ids[0] }) } : undefined,
    }))}
    idOf={item => item.id} titleOf={item => item.label} iconOf={item => item.icon}
    renderExtra={item => item.summary}
    renderEditor={item => item.editor ?? item.summary}
    readOnly={readOnly} reorderable={false}
  />
}
