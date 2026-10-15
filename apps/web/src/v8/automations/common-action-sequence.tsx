'use client'

import type { CommonActionResources, CommonActionStep } from '@/lib/api'
import { CommonActionConfig, commonActionChoices } from '@/components/automations/common-action-editor'
import { ActionAddButton } from '@/components/shared/action-list'
import Button from '@/components/shared/button'
import BranchEditors, { newBranchStep, updateBranchStep } from './branch-editor'
import { newCommonActionStep } from '@/components/automations/common-action-editor'
import styles from './common-action-sequence.module.css'

type SequenceProps = {
  actions: CommonActionStep[]
  onChange: (next: CommonActionStep[]) => void
  resources: CommonActionResources
  resourcesFailed: boolean
}

export function CommonActionAddActions({ actions, onChange, resources }: SequenceProps) {
  const choices = commonActionChoices(resources)
  const append = (step: CommonActionStep) => onChange([...actions, step])
  return <div className={styles.addActions}>
    <ActionAddButton id="ca-add-step" label="処理を足す" choices={choices.filter(choice => !['wait', 'common_action'].includes(choice.id))} onAdd={append} />
    <Button variant="text" onClick={() => append(newCommonActionStep('wait'))}>待ち時間を入れる</Button>
    <Button variant="text" onClick={() => append(newBranchStep())}>条件で分ける</Button>
    <ActionAddButton direct label="見本から受け渡す" choices={choices.filter(choice => choice.id === 'common_action')} onAdd={append} />
  </div>
}

export function CommonActionStepEditor({ step, index, actions, onChange, resources, resourcesFailed }: SequenceProps & { step: CommonActionStep; index: number }) {
  return step.type === 'branch' ? <BranchEditors
    steps={actions} onlyId={step.id} resources={resources}
    onUpdate={(id, patch) => onChange(actions.map(item => item.id === id ? updateBranchStep(item, patch) : item))}
    onRemove={id => onChange(actions.filter(item => item.id !== id))}
  /> : <CommonActionConfig index={index} step={step} resources={resources} resourcesFailed={resourcesFailed} onChange={next => onChange(actions.map(item => item.id === step.id ? next : item))} />
}
