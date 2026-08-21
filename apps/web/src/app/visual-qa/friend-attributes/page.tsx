'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import TagEditorV4 from '@/components/friend-fields/tag-editor-v4'
import TagsPageV4, { FRIEND_ATTRIBUTES_QA_GROUPS, FRIEND_ATTRIBUTES_QA_TAGS } from '@/components/friend-fields/tags-page-v4'
import { DeleteDialog } from '@/components/friend-fields/edit-tag-page-v4'
import FolderEditor from '@/app/tags/folders/new/page'

const EXISTING_TAG = {
  ...FRIEND_ATTRIBUTES_QA_TAGS[2],
  id: 'qa-existing',
  name: 'NEN会員（定期）',
  groupId: 'qa-purchase',
  friendCount: 128,
  mileageReward: 10,
  referralMileageReward: 5,
  mileageMultiplierBps: 15000,
  mileageMultiplierPriority: 3,
  isStarred: false,
}

const LINKED_ACTIONS = [
  { id: 'qa-action-1', type: 'メッセージ', label: '会員登録のお礼を送信', timing: 'すぐに' },
  { id: 'qa-action-2', type: 'タグ', label: '定期購入者タグを追加', timing: 'すぐに' },
  { id: 'qa-action-3', type: 'シナリオ', label: '会員フォローを開始', timing: '24時間後' },
]

function VisualQaPageInner() {
  const state = useSearchParams().get('state') ?? 'list'
  if (state === 'list') return <TagsPageV4 fixture={{ items: FRIEND_ATTRIBUTES_QA_TAGS, groups: FRIEND_ATTRIBUTES_QA_GROUPS }} />
  if (state === 'folder') return <FolderEditor />
  if (state === 'delete') return <><TagsPageV4 fixture={{ items: FRIEND_ATTRIBUTES_QA_TAGS, groups: FRIEND_ATTRIBUTES_QA_GROUPS }} /><DeleteDialog tag={EXISTING_TAG} deleting={false} initialConfirmation={EXISTING_TAG.name} onCancel={() => {}} onDelete={() => {}} /></>

  const edit = state === 'edit' || state === 'retroactive'
  const linked = state === 'linked' || state === 'drawer' || edit
  return (
    <TagEditorV4
      mode={edit ? 'edit' : 'create'}
      groups={FRIEND_ATTRIBUTES_QA_GROUPS}
      tag={edit ? EXISTING_TAG : undefined}
      initialLinked={linked}
      initialDrawerOpen={state === 'drawer'}
      initialApplyToExisting={edit}
      initialRetroactiveOpen={state === 'retroactive'}
      referenceDrawerState={state === 'drawer'}
      referenceRetroactiveState={state === 'retroactive'}
      initialValues={{
        name: linked ? 'NEN会員（定期）' : '',
        groupId: 'qa-purchase',
        isStarred: false,
        linked,
        rewardMiles: linked ? 10 : 0,
        referralRewardMiles: linked ? 5 : 0,
        multiplierBps: linked ? 15000 : null,
        multiplierPriority: linked ? 3 : 0,
        applyToExisting: edit,
        actions: linked ? LINKED_ACTIONS : [],
      }}
      saving={false}
      onCancel={() => {}}
      onSave={async () => {}}
      onDelete={() => {}}
    />
  )
}

export default function FriendAttributesVisualQaPage() {
  return <Suspense fallback={null}><VisualQaPageInner /></Suspense>
}
