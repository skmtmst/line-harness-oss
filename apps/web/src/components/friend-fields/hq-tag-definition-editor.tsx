'use client'

import type { TagGroup } from '@line-crm/shared'
import type { TagDefinition } from '@/lib/hq-templates-api'
import TagEditorV4, {
  definitionsForSave,
  linkedActionFromDefinition,
  type TagEditorActionLabel,
  type TagEditorValues,
} from './tag-editor-v4'

const HQ_PORTABLE_ACTIONS: readonly TagEditorActionLabel[] = ['テキスト送信', 'マイル付与']

export function hqTagDefinitionToEditor(definition: TagDefinition): TagEditorValues {
  const tag = definition.tag
  return {
    name: tag.name,
    groupId: tag.folderId ?? '',
    isStarred: tag.isStarred ?? false,
    linked: tag.linkedEnabled ?? Boolean(tag.mileage?.self || tag.mileage?.referrer || tag.mileage?.multiplier || tag.actions?.length),
    rewardMiles: tag.mileage?.self ?? 0,
    referralRewardMiles: tag.mileage?.referrer ?? 0,
    multiplierBps: tag.mileage?.multiplier ?? null,
    multiplierPriority: tag.mileage?.priority ?? 0,
    applyToExisting: false,
    reapplyPolicy: tag.reapplyPolicy ?? 'first_only',
    actions: (tag.actions ?? []).map(action => linkedActionFromDefinition(action)),
  }
}

export function hqTagEditorToDefinition(definition: TagDefinition, values: TagEditorValues): TagDefinition {
  return {
    schemaVersion: 1,
    tag: {
      ...definition.tag,
      name: values.name.trim(),
      folderId: values.groupId || null,
      isStarred: values.isStarred,
      manualAssignmentAllowed: definition.tag.manualAssignmentAllowed ?? true,
      reapplyPolicy: values.reapplyPolicy,
      linkedEnabled: values.linked,
      mileage: {
        self: values.linked ? values.rewardMiles : 0,
        referrer: values.linked ? values.referralRewardMiles : 0,
        multiplier: values.linked ? values.multiplierBps : null,
        priority: values.linked ? values.multiplierPriority : 0,
      },
      actions: values.linked ? definitionsForSave(values.actions) : [],
    },
    folders: definition.folders,
  }
}

export default function HqTagDefinitionEditor({ definition, saving, error, notice, onCancel, onSave }: {
  definition: TagDefinition
  saving: boolean
  error?: string
  notice?: string
  onCancel: () => void
  onSave: (definition: TagDefinition) => void | Promise<void>
}) {
  const now = new Date().toISOString()
  const groups: TagGroup[] = definition.folders.map((folder, index) => ({
    id: folder.id,
    accountId: null,
    name: folder.name,
    sortOrder: index,
    color: folder.color ?? null,
    createdAt: now,
    updatedAt: now,
  }))
  const initialValues = hqTagDefinitionToEditor(definition)
  return <TagEditorV4
    mode="create"
    embedded
    groups={groups}
    initialLinked={initialValues.linked}
    initialValues={initialValues}
    resources={null}
    allowedActionTypes={HQ_PORTABLE_ACTIONS}
    saving={saving}
    error={error}
    notice={notice}
    onCancel={onCancel}
    onSave={async values => { await onSave(hqTagEditorToDefinition(definition, values)) }}
  />
}
