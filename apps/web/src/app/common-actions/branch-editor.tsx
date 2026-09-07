'use client'

import type { CommonActionResources, CommonActionStep } from '@/lib/api'
import { newCommonActionStep } from '@/components/automations/common-action-editor'
import Button from '@/components/shared/button'
import SelectField from '@/components/shared/select-field'

export function newBranchStep(): CommonActionStep {
  return {
    id: crypto.randomUUID(),
    type: 'branch',
    params: {
      condition: { operator: 'AND', rules: [{ type: 'tag_exists', value: '' }] },
      then: [{ ...newCommonActionStep('common_action'), params: { commonActionId: '' } }],
      else: [{ ...newCommonActionStep('common_action'), params: { commonActionId: '' } }],
    },
    onFailure: 'stop',
  }
}

export function updateBranchStep(
  step: CommonActionStep,
  patch: { tagId?: string; thenId?: string; elseId?: string },
): CommonActionStep {
  if (step.type !== 'branch') return step
  const condition = step.params.condition as { operator: 'AND'; rules: Array<{ type: 'tag_exists'; value: string }> }
  const thenSteps = step.params.then as CommonActionStep[]
  const elseSteps = step.params.else as CommonActionStep[]
  return {
    ...step,
    params: {
      ...step.params,
      condition: patch.tagId === undefined ? condition : {
        operator: 'AND', rules: [{ type: 'tag_exists', value: patch.tagId }],
      },
      then: patch.thenId === undefined ? thenSteps : [{ ...thenSteps[0], params: { commonActionId: patch.thenId } }],
      else: patch.elseId === undefined ? elseSteps : [{ ...elseSteps[0], params: { commonActionId: patch.elseId } }],
    },
  }
}

export default function BranchEditors({
  branches,
  offset,
  resources,
  onUpdate,
  onRemove,
}: {
  branches: CommonActionStep[]
  offset: number
  resources: CommonActionResources
  onUpdate: (id: string, patch: { tagId?: string; thenId?: string; elseId?: string }) => void
  onRemove: (id: string) => void
}) {
  return branches.map((branch, branchIndex) => {
    const condition = branch.params.condition as { rules: Array<{ value: string }> }
    const thenSteps = branch.params.then as CommonActionStep[]
    const elseSteps = branch.params.else as CommonActionStep[]
    const commonActionOptions = [
      { value: '', label: '公開版を選ぶ' },
      ...resources.commonActions.map((item) => ({ value: item.id, label: `${item.name} v${item.version}` })),
    ]
    return (
      <section key={branch.id} className="border-hairline bg-canvas-sunken mt-3 rounded-card border p-4" data-common-action-branch>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-ink font-semibold">{offset + branchIndex + 1}. 条件で分ける</h3>
          <Button onClick={() => onRemove(branch.id)}>分岐を削除</Button>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <label className="text-ink-secondary text-sm">条件のタグ
            <SelectField className="mt-1 w-full" value={String(condition.rules[0]?.value ?? '')} onChange={(event) => onUpdate(branch.id, { tagId: event.target.value })} options={[{ value: '', label: 'タグを選ぶ' }, ...resources.tags.map((tag) => ({ value: tag.id, label: tag.name }))]} />
          </label>
          <label className="text-ink-secondary text-sm">当てはまるとき
            <SelectField className="mt-1 w-full" value={String(thenSteps[0]?.params.commonActionId ?? '')} onChange={(event) => onUpdate(branch.id, { thenId: event.target.value })} options={commonActionOptions} />
          </label>
          <label className="text-ink-secondary text-sm">当てはまらないとき
            <SelectField className="mt-1 w-full" value={String(elseSteps[0]?.params.commonActionId ?? '')} onChange={(event) => onUpdate(branch.id, { elseId: event.target.value })} options={commonActionOptions} />
          </label>
        </div>
        <p className="text-ink-faint mt-2 text-xs">タグ条件を判定し、選んだ公開版の共通アクションだけを実行します。選ばなかった側は実行記録へ「分岐対象外」と残ります。</p>
      </section>
    )
  })
}
