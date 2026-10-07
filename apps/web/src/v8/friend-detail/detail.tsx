'use client'

/*
 * ★V8 友だち詳細（Pencil「★P1-4 友だち詳細」Q5F2QE・概要は JCDRm）。
 *
 * 入口は app/friends/detail/page.tsx（V8 のときだけこの画面）。
 * データの口・権限・失敗の扱いは今の画面と同じ（BEHAVIOR.md）。見せ方だけ絵どおり：
 * 板の頭（顔・名前・札・補足／…・個別操作・受信箱で開く）→ タブ10個 → タブの中身。
 * タブの中身はタブごとのファイルに分けた。
 */
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, CircleCheck, Copy, List, MessageCircle, MessageSquare, MoreHorizontal, Star, Workflow, Zap } from 'lucide-react'
import Avatar from '@/components/shared/avatar'
import Button from '@/components/shared/button'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Notice from '@/components/shared/notice'
import StatusBadge from '@/components/shared/status-badge'
import TargetMissing from '@/components/shared/target-missing'
import { Tabs } from '@/components/shared/tabs'
import { FeatureDisabledScreen } from '@/components/feature-disabled-gate'
import { PageFrame } from '@/components/templates/page-frame'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { useFeatureVisibility } from '@/lib/use-feature-visibility'
import { formatDay } from '@/lib/format'
import { useFriendDetail } from './use-friend-detail'
import { useFriendDetailPermissions } from './permissions'
import { useScenarioPicker, useSupportEditor } from './dialogs'
import { inboxHrefForFriend } from './timeline'
import { SUPPORT_LABELS, SUPPORT_TONES } from './support'
import OverviewTab from './overview-tab'
import HistoryTab from './history-tab'
import InfoTab, { BASIC_GROUP } from './info-tab'
import FormsTab from './forms-tab'
import ScenarioTab from './scenario-tab'
import BookingsTab from './bookings-tab'
import RemindersTab from './reminders-tab'
import ActionsTab from './actions-tab'
import MilesTab from './miles-tab'
import RichMenuTab from './rich-menu-tab'
import styles from './detail.module.css'

/** タブ10個（並びと URL の値は今の画面と同じ）。 */
export const FRIEND_DETAIL_TABS = [
  { key: 'timeline', label: '概要' },
  { key: 'history', label: '履歴' },
  { key: 'info', label: '情報欄' },
  { key: 'forms', label: '回答フォーム' },
  { key: 'scenario', label: '配信・シナリオ' },
  { key: 'orders', label: '予約' },
  { key: 'reminders', label: 'リマインダ' },
  { key: 'actions', label: 'アクション' },
  { key: 'miles', label: 'マイル' },
  { key: 'richmenu', label: 'リッチメニュー' },
] as const
type TabKey = (typeof FRIEND_DETAIL_TABS)[number]['key']

function FriendDetailV8Inner() {
  const params = useSearchParams()
  const router = useRouter()
  const friendId = params.get('id') ?? ''
  const rawTab = params.get('tab')
  const tab: TabKey = (FRIEND_DETAIL_TABS.find((t) => t.key === rawTab)?.key ?? 'timeline') as TabKey
  const group = params.get('group') ?? BASIC_GROUP
  const { selectedAccountId, selectedAccount } = useAccount()
  // 情報欄タブは friend_fields の画面。オフのアカウントではタブごと出さない。
  const fieldsEnabled = useFeatureVisibility(selectedAccountId).enabled('friend_fields')
  const visibleTabs = fieldsEnabled ? FRIEND_DETAIL_TABS : FRIEND_DETAIL_TABS.filter((t) => t.key !== 'info')
  const data = useFriendDetail(friendId, selectedAccountId, tab)
  const perms = useFriendDetailPermissions()
  const { friend } = data
  usePageTitle(friend?.displayName ?? '友だち詳細')
  usePageCrumbs([{ label: '友だち', href: '/friends' }])

  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [supportNotice, setSupportNotice] = useState('')
  const [supportAlert, setSupportAlert] = useState('')
  const [scenarioNotice, setScenarioNotice] = useState('')

  const support = useSupportEditor(
    friendId,
    (notice) => { setSupportAlert(''); setSupportNotice(notice); void data.loadFriend() },
    (message) => { setSupportNotice(''); setSupportAlert(message); void data.loadFriend() },
  )
  const scenario = useScenarioPicker(friendId, friend?.displayName ?? '', selectedAccountId, (notice) => {
    setScenarioNotice(notice)
    // 登録は履歴に現れうるので、取り済みなら取り直す。
    if (data.historyStatus === 'ready') void data.loadHistory()
  })

  const inbox = inboxHrefForFriend(friendId)
  // 「個別操作」＝この友だちへの操作。権限が無い操作は出さない（絵 2.）。
  const primaryActions: ActionMenuItem[] = [
    ...(perms.editSupport ? [{ id: 'support', label: '対応状況を編集', icon: <CircleCheck size={16} />, onSelect: () => void support.openEditor() }] : []),
    ...(fieldsEnabled && perms.saveFields
      ? [{ id: 'fields', label: '情報欄を編集', icon: <List size={16} />, onSelect: () => router.push(`/friends/detail?id=${encodeURIComponent(friendId)}&tab=info`) }]
      : []),
    ...(perms.manage ? [{ id: 'scenario-enroll', label: 'シナリオに登録する', icon: <Workflow size={16} />, onSelect: () => void scenario.openPicker() }] : []),
    {
      id: 'send-template',
      label: 'テンプレートを送る',
      icon: <MessageSquare size={16} />,
      dividerBefore: perms.editSupport || perms.manage || (fieldsEnabled && perms.saveFields),
      onSelect: () => router.push(inbox),
    },
  ]
  // 「…」＝関連する画面を開く。別の画面へ移るものは ↗（external）。
  const secondaryActions: ActionMenuItem[] = [
    { id: 'templates', label: 'テンプレート一覧を見る', icon: <List size={16} />, external: true, onSelect: () => router.push('/templates') },
    { id: 'scenarios', label: 'シナリオ一覧を見る', icon: <List size={16} />, external: true, onSelect: () => router.push('/scenarios') },
    { id: 'reminders', label: 'リマインダ一覧を見る', icon: <List size={16} />, external: true, onSelect: () => router.push('/reminders') },
    { id: 'mileage', label: 'マイルを確認', icon: <Star size={16} />, external: true, onSelect: () => router.push('/mileage') },
    { id: 'duplicates', label: '重複候補を確認', icon: <Copy size={16} />, external: true, onSelect: () => router.push('/duplicates') },
    { id: 'back-to-list', label: '友だち一覧へ戻る', icon: <ArrowLeft size={16} />, dividerBefore: true, onSelect: () => router.push('/friends') },
  ]

  // ---- 開けないとき（白い板の中に1つだけ。題・タブは出さない） ----
  if (!friendId) {
    return <TargetMissing kind="unspecified" title="見る友だちが指定されていません" description="友だちの一覧から、見たい人を選び直してください。" backHref="/friends" backLabel="友だち一覧へ戻る" />
  }
  if (!data.loading && data.loadForbidden) {
    // 403 は見つからない案内より先に分ける（監査 228-003）。押しても直らないので再試行は出さない。
    return <TargetMissing kind="error" title="この友だちを見る権限がありません" description="見るには権限が要ります。オーナーか管理者の方に確認してください。" backHref="/friends" backLabel="友だち一覧へ戻る" />
  }
  if (!data.loading && (data.friendMissing || (!data.error && !friend))) {
    return <TargetMissing kind="not-found" title="この友だちは見つかりません" description="削除されたか、別の LINE アカウントの人です。一覧から選び直してください。" accountName={selectedAccount?.name} backHref="/friends" backLabel="友だち一覧へ戻る" />
  }
  if (!data.loading && !friend) {
    return <TargetMissing kind="error" title="友だちを読み込めませんでした" description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。" onRetry={() => void data.loadFriend()} />
  }

  const status = friend?.support?.status
  const subtitle = friend
    ? `LINE 表示名：${friend.displayName || '—'}・${friend.createdAt ? `${formatDay(friend.createdAt).replace(/（.）$/, '')}に友だち追加` : '—'}・担当 ${friend.support?.operatorName ?? '未割り当て'}`
    : '読み込んでいます…'
  const realName = data.fields.find((f) => f.name === '本名')?.value ?? ''

  return (
    <PageFrame kind="detail" boardId="Q5F2QE">
      <header className={styles.head}>
        <Avatar name={friend?.displayName} src={friend?.pictureUrl} size={52} />
        <div className={styles.nameBlock}>
          <div className={styles.nameRow}>
            <h2 className={styles.name} title={friend?.displayName}>{friend?.displayName ?? '友だち詳細'}</h2>
            {status ? <StatusBadge tone={SUPPORT_TONES[status]} size="compact">{SUPPORT_LABELS[status]}</StatusBadge> : friend ? <span className={styles.faint}>やり取りなし</span> : null}
          </div>
          <p className={styles.sub} title={subtitle}>{subtitle}</p>
        </div>
        <span className={styles.menuAnchor}>
          <Button
            className={styles.square}
            aria-label="その他の操作"
            aria-haspopup="menu"
            aria-expanded={moreMenuOpen}
            onClick={() => { setMoreMenuOpen((v) => !v); setActionMenuOpen(false) }}
          >
            <MoreHorizontal aria-hidden />
          </Button>
          <ActionMenu open={moreMenuOpen} items={secondaryActions} ariaLabel="関連する画面を開く" onClose={() => setMoreMenuOpen(false)} />
        </span>
        <span className={styles.menuAnchor}>
          <Button
            aria-haspopup="menu"
            aria-expanded={actionMenuOpen}
            onClick={() => { setActionMenuOpen((v) => !v); setMoreMenuOpen(false) }}
          >
            <Zap aria-hidden />個別操作
          </Button>
          <ActionMenu open={actionMenuOpen} items={primaryActions} ariaLabel="この友だちへの個別操作" onClose={() => setActionMenuOpen(false)} />
        </span>
        <Button href={inbox} variant="primary"><MessageCircle aria-hidden />受信箱で開く</Button>
      </header>

      {perms.viewOnly ? (
        <div className={styles.band}>
          <Notice tone="info" message="閲覧のみで見ています。変える操作は管理者に頼んでください。" />
        </div>
      ) : null}

      <div className={styles.tabs}>
        <Tabs
          label="友だち詳細の中身"
          items={visibleTabs.map((t) => ({
            label: t.label,
            href: `/friends/detail?id=${encodeURIComponent(friendId)}&tab=${t.key}${group === BASIC_GROUP ? '' : `&group=${encodeURIComponent(group)}`}`,
            current: tab === t.key,
          }))}
        />
      </div>

      {data.error && friend ? (
        <div className={styles.notice}><Notice tone="danger" message={data.error} onClose={() => data.setError('')} /></div>
      ) : null}
      {supportNotice || supportAlert ? (
        <div className={styles.notice}>
          <Notice tone={supportAlert ? 'warn' : 'success'} message={supportAlert || supportNotice} onClose={() => { setSupportNotice(''); setSupportAlert('') }} />
        </div>
      ) : null}

      {data.loading || !friend ? (
        <div className={styles.pane}><p className={styles.paneNote}>読み込んでいます…</p></div>
      ) : tab === 'timeline' ? (
        <OverviewTab
          friend={friend}
          friendId={friendId}
          data={data}
          perms={perms}
          fields={data.fields}
          values={data.values}
          realName={realName}
          onEditSupport={() => void support.openEditor()}
          onEnrollScenario={() => void scenario.openPicker()}
          scenarioNotice={scenarioNotice}
        />
      ) : tab === 'history' ? (
        <HistoryTab friend={friend} friendId={friendId} data={data} />
      ) : tab === 'info' ? (
        fieldsEnabled ? <InfoTab friendId={friendId} group={group} data={data} perms={perms} /> : <FeatureDisabledScreen featureId="friend_fields" />
      ) : tab === 'forms' ? (
        <FormsTab data={data} />
      ) : tab === 'scenario' ? (
        <ScenarioTab canEnroll={perms.manage} onEnroll={() => void scenario.openPicker()} />
      ) : tab === 'orders' ? (
        <BookingsTab />
      ) : tab === 'reminders' ? (
        <RemindersTab />
      ) : tab === 'actions' ? (
        <ActionsTab friendId={friendId} />
      ) : tab === 'miles' ? (
        <MilesTab friendId={friendId} />
      ) : (
        <RichMenuTab />
      )}

      {tab !== 'timeline' && scenarioNotice ? <div className={styles.notice}><Notice tone="success" message={scenarioNotice} onClose={() => setScenarioNotice('')} /></div> : null}
      {support.dialog}
      {scenario.dialog}
    </PageFrame>
  )
}

export default function FriendDetailV8() {
  return (
    <Suspense fallback={<div className={styles.pane}><p className={styles.paneNote}>読み込んでいます…</p></div>}>
      <FriendDetailV8Inner />
    </Suspense>
  )
}
