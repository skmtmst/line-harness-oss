'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import TagEditorV4 from '@/components/friend-fields/tag-editor-v4'
import TagsPageV4, { FRIEND_ATTRIBUTES_QA_GROUPS, FRIEND_ATTRIBUTES_QA_TAGS } from '@/components/friend-fields/tags-page-v4'
import { DeleteDialog } from '@/components/friend-fields/edit-tag-page-v4'
import FolderEditor from '@/app/tags/folders/new/page'
import { TextArea, TextInput } from '@/components/shared/form-controls'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'

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

function ControlsVisualQa() {
  const [input, setInput] = useState('')
  const [textarea, setTextarea] = useState('')
  const [search, setSearch] = useState('')
  const [select, setSelect] = useState('all')
  const options = [
    { value: 'all', label: 'すべて' },
    { value: 'active', label: '使用中' },
    { value: 'unused', label: '未使用' },
  ]

  return (
    <main className="min-h-screen bg-canvas-sunken p-10">
      <h1 className="text-2xl font-semibold text-ink">V5 共通入力部品</h1>
      <p className="mt-2 text-sm text-ink-secondary">通常・入力済み・無効・エラー・開状態を確認する固定表示です。</p>
      <div className="mt-8 grid gap-10">
        <section data-qa-control="input" style={{ width: 320 }}>
          <TextInput value={input} onChange={(event) => setInput(event.target.value)} placeholder="入力してください" aria-label="共通入力欄" />
        </section>
        <section data-qa-control="textarea" style={{ width: 480 }}>
          <TextArea value={textarea} onChange={(event) => setTextarea(event.target.value)} placeholder="本文を入力してください" aria-label="共通複数行入力欄" />
        </section>
        <section data-qa-control="search" style={{ width: 720 }}>
          <SearchField value={search} onChange={setSearch} onClear={() => setSearch('')} placeholder="名前・LINE名・タグ・メモで検索" aria-label="友だちを検索" />
        </section>
        <section data-qa-control="select-closed" style={{ width: 176 }}>
          <Select aria-label="タグ" label="タグ" value="all" onChange={() => {}} options={[{ value: 'all', label: 'すべて' }]} size="full" />
        </section>
        <section data-qa-control="select-page-size" style={{ width: 128 }}>
          <Select aria-label="表示件数" value="20" onChange={() => {}} options={[{ value: '20', label: '20件表示' }]} size="full" />
        </section>
        <section data-qa-control="select-open" style={{ width: 844, minHeight: 156 }}>
          <Select aria-label="使用状態" label="使用状態" value={select} onChange={setSelect} options={options} size="full" defaultOpen />
        </section>
      </div>
    </main>
  )
}

function VisualQaPageInner() {
  const state = useSearchParams().get('state') ?? 'list'
  if (state === 'controls') return <ControlsVisualQa />
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
