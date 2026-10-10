'use client'
import type { CommonActionResources, CommonActionStep } from '@/lib/api'
import ActionList from '@/components/shared/action-list'
import { EntityPickerField } from '@/components/shared/entity-picker'
import Notice from '@/components/shared/notice'
import { newCommonActionStep } from './common-action-editor'

/** 分岐の両側も同じ行。編集できない子処理は保存値を保って表示する。 */
export default function BranchActionList({ value, resources, label, onChange, titleOf }: {
  value: CommonActionStep[]; resources: CommonActionResources; label: string; onChange: (next: CommonActionStep[]) => void; titleOf: (step: CommonActionStep) => string
}) {
  const options = resources.commonActions
  return <ActionList value={value} onChange={onChange} minItems={1} idOf={step => step.id} titleOf={step => step.type === 'common_action'
    ? options.find(option => option.id === step.params.commonActionId)?.name ?? '共通アクションを選ぶ' : titleOf(step)} kindOf={() => label}
    choices={[{ id: 'common_action', label: '共通アクションを実行する', make: () => newCommonActionStep('common_action'), picker: {
      title: '共通アクションを選ぶ', items: options, apply: (step, ids) => ({ ...step, params: { ...step.params, commonActionId: ids[0] } }),
    } }]}
    renderEditor={(step, update, index) => step.type === 'common_action'
      ? <EntityPickerField label={`${label}${index + 1}の公開版`} noun="共通アクション" items={options} value={String(step.params.commonActionId ?? '')} onChange={commonActionId => update({ ...step, params: { ...step.params, commonActionId } })} />
      : <Notice tone="info">{titleOf(step)}（ここでは変えられません）</Notice>} />
}
