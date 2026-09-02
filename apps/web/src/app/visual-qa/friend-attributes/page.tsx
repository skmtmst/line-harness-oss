'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowDown, ArrowUp, Palette, Pencil, Trash2 } from 'lucide-react'
import TagEditorV4 from '@/components/friend-fields/tag-editor-v4'
import TagsPageV4, { FRIEND_ATTRIBUTES_QA_GROUPS, FRIEND_ATTRIBUTES_QA_TAGS } from '@/components/friend-fields/tags-page-v4'
import { DeleteDialog } from '@/components/friend-fields/edit-tag-page-v4'
import FolderEditor from '@/app/tags/folders/new/page'
import { TextArea, TextInput } from '@/components/shared/form-controls'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import ActionMenu from '@/components/shared/action-menu'
import Dialog from '@/components/shared/dialog'
import Drawer from '@/components/shared/drawer'
import Notice from '@/components/shared/notice'
import NotificationPanel, { type NotificationItem } from '@/components/shared/notification-panel'

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
  { id: 'qa-action-1', type: 'テキスト送信', label: '会員登録のお礼を送信', timing: 'すぐに' },
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

const QA_NOTIFICATIONS: NotificationItem[] = [
  { id: '1', title: '一斉配信「8月号のご案内」で12件が送信失敗', meta: '昨日 10:04　・　配信結果を開く', unread: true, filterId: 'error' },
  { id: '2', title: 'LINE Webhook の応答遅延を検知しました', meta: '8/21 18:32　・　運用状態を開く', unread: true, filterId: 'error' },
  { id: '3', title: 'EC連携の取り込みが3件失敗しています', meta: '8/21 09:15　・　EC連携を開く', unread: true, filterId: 'error' },
  { id: '4', title: 'v0.25 の更新が利用できます', meta: '8/20　・　更新履歴を見る', filterId: 'update' },
  { id: '5', title: 'v0.24.1 を適用しました', meta: '8/14　・　更新履歴を見る', filterId: 'update' },
  { id: '6', title: 'メンテナンス予定　8/30 2:00〜4:00', meta: '8/12　・　詳細を見る', filterId: 'update' },
]

function OverlaysVisualQa({ state }: { state: string }) {
  const [noticeVisible, setNoticeVisible] = useState(true)
  const [filter, setFilter] = useState('all')
  const [dialogOpen, setDialogOpen] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(true)
  const noop = () => {}
  const menuItems = [
    { id: 'rename', label: '名前を変更', icon: <Pencil size={15} />, onSelect: noop },
    { id: 'color', label: '色を変える', icon: <Palette size={15} />, onSelect: noop },
    { id: 'up', label: '並び順を上へ', icon: <ArrowUp size={15} />, onSelect: noop },
    { id: 'down', label: '並び順を下へ', icon: <ArrowDown size={15} />, onSelect: noop },
    { id: 'delete', label: 'フォルダを削除', icon: <Trash2 size={15} />, tone: 'danger' as const, dividerBefore: true, onSelect: noop },
  ]

  return (
    <main className="min-h-screen bg-canvas-sunken p-10">
      <h1 className="text-2xl font-semibold text-ink">V5 共通オーバーレイ部品</h1>
      <p className="mt-2 text-sm text-ink-secondary">標準確認・重要操作・右詳細・通知・操作メニューの固定表示です。</p>
      <div className="mt-8">
        {state === 'overlays-dialog' ? <section data-qa-overlay="dialog" style={{ width: 844 }}><Dialog open={dialogOpen} modal={false} title="変更内容を保存しますか？" description="保存すると、この設定が次回の配信から反映されます。" onCancel={() => setDialogOpen(false)} onConfirm={noop} /></section> : null}
        {state === 'overlays-destructive' ? <section data-qa-overlay="destructive" style={{ width: 844 }}><Dialog open modal={false} tone="destructive" title="2人の友だち情報を統合しますか？" description="統合後は元に戻せません。残す情報と削除される情報を確認してください。" onCancel={noop} onConfirm={noop} confirmLabel="統合する" /></section> : null}
        {state === 'overlays-drawer' ? <section data-qa-overlay="drawer"><Drawer open={drawerOpen} modal={false} title="友だち詳細" details={[{ label: '表示名', value: 'Kenta Kawano' }, { label: '担当', value: '未設定' }, { label: '状態', value: '対応中' }]} onClose={() => setDrawerOpen(false)} /></section> : null}
        {state === 'overlays-notices' ? <section data-qa-overlay="notices" className="grid gap-4" style={{ width: 844 }}>{noticeVisible ? <><Notice tone="success" message="保存しました" onClose={() => setNoticeVisible(false)} /><Notice tone="validation" message="入力内容を確認してください" onClose={noop} /><Notice tone="error" message="処理に失敗しました" onClose={noop} /></> : <button type="button" onClick={() => setNoticeVisible(true)}>通知を戻す</button>}</section> : null}
        {state === 'overlays-menu' ? <section data-qa-overlay="menu"><ActionMenu open inline items={menuItems} note="削除しても、中の配信は未分類に残ります。" onClose={noop} /></section> : null}
        {state === 'overlays-notification-panel' ? <section data-qa-overlay="notification-panel"><NotificationPanel open inline items={QA_NOTIFICATIONS} filters={[{ id: 'all', label: 'すべて', count: 6 }, { id: 'error', label: 'エラー', count: 3 }, { id: 'update', label: 'アップデート', count: 3 }]} activeFilter={filter} unreadCount={3} onFilterChange={setFilter} onMarkAllRead={noop} /></section> : null}
      </div>
    </main>
  )
}

function VisualQaPageInner() {
  const state = useSearchParams().get('state') ?? 'list'
  if (state === 'controls') return <ControlsVisualQa />
  if (state.startsWith('overlays-')) return <OverlaysVisualQa state={state} />
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
