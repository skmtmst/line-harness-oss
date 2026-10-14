'use client'

import ReadOnlyNotice from '@/components/shared/read-only-notice'
import { useState } from 'react'
import KpiCard from '@/components/shared/kpi-card'
import { Eye } from 'lucide-react'
import StatusBadge from '@/components/shared/status-badge'
import { useAccount } from '@/contexts/account-context'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { restaurantTestApi, type RestaurantLineFlow } from '@/lib/restaurant-test-api'
import RestaurantFrame, { type RestaurantContext } from '../common-a/frame'
import { Panel, StatRow } from '../common-a/parts'
import styles from './line-followup.module.css'
import { DetailColumns } from '@/components/templates/detail-columns'
import { DataTable, TableHeadRow, Th, Tr, Td, RowNameButton } from '@/components/shared/table'
import { FlowEditor, FlowPreview, type FlowDraft } from './flow-editor'

/* ★V8 LINE来店フォロー。通知の一覧・選んだ通知の入力・畳めるプレビュー。 */

/** 数の並びに出す4種（本物の flow_type）と、カードの頭の名前。 */
const FLOW_KINDS: Record<string, { stat: string; note: string; title: string }> = {
  reservation_24h: { stat: '予約24時間前', note: '変更・取消導線', title: '予約24時間前のご案内' },
  reservation_2h: { stat: '予約2時間前', note: '当日のご案内', title: '予約2時間前のご案内' },
  post_visit: { stat: '来店後', note: 'お礼メッセージ', title: 'ご来店のお礼' },
  review_request: { stat: '口コミ依頼', note: 'Google への導線', title: '口コミのお願い' },
}
const OTHER_TITLES: Record<string, string> = { member_card: 'デジタル会員証', one_tap_booking: '前回と同じ内容で予約' }

export function timingLabel(flow: RestaurantLineFlow): string {
  if (flow.timing_minutes === null) return '配信：常設'
  const hours = Math.abs(flow.timing_minutes) / 60
  const amount = Number.isInteger(hours) ? `${hours}時間` : `${Math.abs(flow.timing_minutes)}分`
  return `配信：${amount}${flow.timing_minutes < 0 ? '前' : '後'}`
}

function LineFollowupBoard({ ctx }: { ctx: RestaurantContext }) {
  const { data, store, busy, mutate } = ctx
  const { selectedAccountId } = useAccount()
  const [selectedId, setSelectedId] = useState('')
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, FlowDraft>>({})
  const [draftAccount, setDraftAccount] = useState(selectedAccountId)
  if (draftAccount !== selectedAccountId) {
    setDraftAccount(selectedAccountId)
    setDrafts({})
    setSelectedId('')
    setPreviewExpanded(false)
  }
  const role = useStaffRole()
  const readOnly = !canManageRole(role)
  const flows = data.lineFlows.filter((flow) => !store || !flow.store_id || flow.store_id === store.id)
  const has = (type: string) => flows.some((flow) => flow.flow_type === type)
  const selected = flows.find(flow => flow.id === selectedId) ?? flows[0]
  const draft = selected ? drafts[selected.id] ?? { title: selected.title, body: selected.body } : null
  const nameOf = (flow: RestaurantLineFlow) => FLOW_KINDS[flow.flow_type]?.title ?? OTHER_TITLES[flow.flow_type] ?? flow.flow_type
  return (
    <>
      <div className={styles.caution} role="note">
        <Eye aria-hidden className={styles.cautionIcon} />
        <span>いまは「確認用」です。保存しても、お客さまへはまだ送りません。本当に送るのは、本送信の準備ができてから（司令塔の確認のあと）切り替えます。</span>
      </div>
      {readOnly ? (
        <ReadOnlyNotice role="note" />
      ) : null}
      <StatRow>
        <KpiCard density="compact" title="フロー" valueText={`${flows.length}`} detail="カードテンプレート" icon={null} presentation="band" value={null} unit="" />
        {Object.entries(FLOW_KINDS).map(([type, kind]) => (
          <KpiCard key={type} density="compact" title={kind.stat} valueText={has(type) ? '確認用' : '未作成'} detail={kind.note} icon={null} presentation="band" value={null} unit="" />
        ))}
        <KpiCard density="compact" title="本送信" valueText="停止中" detail="プレビューのみ" valueTone={true ? 'warning' : 'default'} icon={null} presentation="band" value={null} unit="" />
      </StatRow>
      <DetailColumns presentation="notification" asideLabel="LINEでの見え方" expanded={previewExpanded} onExpandedChange={setPreviewExpanded}
        aside={selected && draft ? <FlowPreview flow={selected} draft={draft} accountName={store?.line_account_name || store?.name || 'LINE公式アカウント'} /> : null}>
        <DataTable columnSizing="content">
          <thead><TableHeadRow><Th grow>お知らせ</Th><Th>配信のタイミング</Th><Th>状態</Th></TableHeadRow></thead>
          <tbody>{flows.map(flow => <Tr key={flow.id}>
            <Td grow><RowNameButton selected={selected?.id === flow.id} onClick={() => setSelectedId(flow.id)}>{nameOf(flow)}</RowNameButton></Td>
            <Td>{timingLabel(flow)}</Td>
            <Td><StatusBadge tone="warning">{flow.delivery_mode === 'disabled' ? '送信しない' : 'プレビューのみ'}</StatusBadge></Td>
          </Tr>)}</tbody>
        </DataTable>
        {selected && draft ? <FlowEditor key={selected.id} flow={selected} name={nameOf(selected)} draft={draft} readOnly={readOnly} busy={busy}
          onChange={next => setDrafts(current => ({ ...current, [selected.id]: next }))}
          onSave={() => { if (selectedAccountId) void mutate(() => restaurantTestApi.updateLineFlow(selectedAccountId, selected.id, draft), '下書きを保存しました。送信はまだ行いません。') }} /> : null}
      </DetailColumns>
      <Panel title="LINE ミニアプリ連携" description="将来の切り離しを前提に、予約・会員証の境界を分離しています。" >
        <div className={styles.miniGrid}>
        <div className={styles.miniCard}>
          <p className={styles.miniKicker}>DIGITAL MEMBERSHIP</p>
          <h3 className={styles.miniTitle}>デジタル会員証</h3>
          <p className={styles.miniText}>スタンプカード・会員ランク・来店履歴を、LINE ミニアプリへ表示する設計です。</p>
        </div>
        <div className={styles.miniCard}>
          <p className={styles.miniKicker}>ONE TAP BOOKING</p>
          <h3 className={styles.miniTitle}>前回と同じ内容で予約</h3>
          <p className={styles.miniText}>顧客カルテの過去履歴から、店舗・人数・コースを差し込む1タップ予約です。</p>
        </div>
        </div>
      </Panel>
    </>
  )
}

export default function LineFollowupV8() {
  return (
    <RestaurantFrame
      boardId="n9vvGx"
      title="LINE来店フォロー"
      description="予約前・来店後・口コミ依頼・会員証をカード型で設計します。"
    >
      {(ctx) => <LineFollowupBoard ctx={ctx} />}
    </RestaurantFrame>
  )
}
