import type { FormAction, FormInputBlock, FormLayout } from '@line-crm/shared'

type FormDestinationSummary = {
  friendFieldCount: number
  tagCount: number
  label: string
}

function collectActionDestinations(
  actions: FormAction[] | undefined,
  friendFields: Set<string>,
  tags: Set<string>,
) {
  for (const action of actions ?? []) {
    if (action.kind === 'friend_field' && action.fieldId) {
      friendFields.add(action.fieldId)
    }
    if (action.kind === 'tag') {
      for (const tagId of action.tagIds) {
        if (tagId) tags.add(tagId)
      }
    }
  }
}

function collectInputDestinations(
  block: FormInputBlock,
  friendFields: Set<string>,
  tags: Set<string>,
) {
  for (const fieldId of block.destinations?.friendFieldIds ?? []) {
    if (fieldId) friendFields.add(fieldId)
  }
  if (block.destinations?.realName) friendFields.add('friends.real_name')
  if (block.destinations?.displayName) friendFields.add('friends.display_name')
  if (block.destinations?.note) friendFields.add('friends.note')
  if (block.choiceMode === 'friendField' && block.choiceFriendFieldId) {
    friendFields.add(block.choiceFriendFieldId)
  }

  for (const choice of block.choices ?? []) {
    if (block.choiceMode === 'tag' && choice.tagId) tags.add(choice.tagId)
    if (block.choiceMode === 'action') {
      collectActionDestinations(choice.actions, friendFields, tags)
    }
  }
}

/**
 * 一覧で「答えると何が書き換わるか」を、フォーム定義の実値から数える。
 * 同じ情報欄・タグを複数の質問で使っても、保存先としては1か所なので
 * 重複して数えない。
 */
export function summarizeFormDestinations(
  layout: FormLayout,
  onSubmitTagId: string | null,
): FormDestinationSummary {
  const friendFields = new Set<string>()
  const tags = new Set<string>()

  for (const section of layout.sections) {
    for (const block of section.blocks) {
      if (block.kind === 'input') {
        collectInputDestinations(block, friendFields, tags)
      }
    }
  }
  collectActionDestinations(layout.options.afterActions, friendFields, tags)
  if (onSubmitTagId) tags.add(onSubmitTagId)

  const friendFieldCount = friendFields.size
  const tagCount = tags.size
  return {
    friendFieldCount,
    tagCount,
    label: `友だち情報欄 ${friendFieldCount}・タグ ${tagCount}`,
  }
}
