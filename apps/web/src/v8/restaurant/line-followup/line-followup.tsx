'use client'

import ReadOnlyNotice from '@/components/shared/read-only-notice'
import { useState, type ComponentType } from 'react'
import { Bell, CalendarPlus, Check, IdCard, LogOut, MessageSquare, Star } from 'lucide-react'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import Notice from '@/components/shared/notice'
import StatusBadge from '@/components/shared/status-badge'
import { useAccount } from '@/contexts/account-context'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { restaurantTestApi, type RestaurantLineFlow } from '@/lib/restaurant-test-api'
import { RestaurantFrame, type RestaurantContext } from '@/v8/restaurant/common-a/public/frame/index'
import styles from './line-followup.module.css'
import { DetailColumns } from '@/components/templates/detail-columns'
import { FlowEditor, FlowPreview, type FlowDraft } from './flow-editor'

/*
 * ★V8 LINE来店フォロー（融合 ・絵 ）。
 * フローを行で並べ、押した行の下に中身（題と吹き出し）を開く。右は LINE での見え方。
 * 吹き出しの枠はシナリオ・一斉配信と同じ共通の MessageComposer。
 */

type FlowKind = { name: string; note: string; icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }> }

/** 本物の flow_type ごとの名前・説明・印（行）。 */
const FLOW_KINDS: Record<string, FlowKind> = {
  reservation_24h: { name: '予約 24時間前', note: '前日の確かめ・変更と取り消しの案内', icon: Bell },
  reservation_2h: { name: '予約 2時間前', note: '当日のご案内', icon: Bell },
  post_visit: { name: '来店後（退店のきっかけ）', note: 'ご来店のお礼', icon: LogOut },
  review_request: { name: '口コミ依頼', note: '全員に Google の口コミの案内を出す', icon: Star },
  member_card: { name: '会員証', note: '', icon: IdCard },
  one_tap_booking: { name: 'ワンタップ予約', note: '', icon: CalendarPlus },
}

export function timingLabel(flow: RestaurantLineFlow): string {
  if (flow.timing_minutes === null) return '常設'
  const hours = Math.abs(flow.timing_minutes) / 60
  const amount = Number.isInteger(hours) ? `${hours}時間` : `${Math.abs(flow.timing_minutes)}分`
  if (flow.timing_minutes < 0) return `${amount}前`
  return flow.flow_type === 'post_visit' ? `退店から ${amount}後` : `${amount}後`
}

const kindOf = (flow: RestaurantLineFlow): FlowKind => FLOW_KINDS[flow.flow_type] ?? { name: flow.flow_type, note: '', icon: MessageSquare }

function flowsOf(ctx: RestaurantContext) {
  return ctx.data.lineFlows.filter((flow) => !ctx.store || !flow.store_id || flow.store_id === ctx.store.id)
}

type Drafts = Record<string, FlowDraft>

function LineFollowupBoard({ ctx, selectedId, setSelectedId, drafts, setDrafts, readOnly }: {
  ctx: RestaurantContext
  selectedId: string
  setSelectedId: (id: string) => void
  drafts: Drafts
  setDrafts: (update: (current: Drafts) => Drafts) => void
  readOnly: boolean
}) {
  const { store, busy } = ctx
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const flows = flowsOf(ctx)
  const selected = flows.find(flow => flow.id === selectedId) ?? flows[0]
  const draft = selected ? drafts[selected.id] ?? { title: selected.title, body: selected.body } : null
  return (
    <>
      <Notice tone="info">LINE来店フォローは、来店・退店のきっかけを使う「シナリオのひな形」としてまとめる。行を押すと、その中身をシナリオの一歩と同じ形で直せる。</Notice>
      {readOnly ? <ReadOnlyNotice role="note" /> : null}
      <DetailColumns presentation="notification" asideLabel="LINEでの見え方" expanded={previewExpanded} onExpandedChange={setPreviewExpanded}
        aside={selected && draft ? <FlowPreview flow={selected} draft={draft} accountName={store?.line_account_name || store?.name || 'LINE公式アカウント'} /> : null}>
        <div className={styles.flowList}>
          {flows.map(flow => {
            const kind = kindOf(flow)
            const Icon = kind.icon
            const isSelected = selected?.id === flow.id
            return <div key={flow.id} className={styles.flowItem}>
              <Card padding="none" contentPadding="0px 0px" selected={isSelected}>
                <button type="button" className={styles.flowButton} aria-expanded={isSelected} aria-label={kind.name} onClick={() => setSelectedId(flow.id)}>
                  <span className={styles.flowIcon}><Icon size={16} aria-hidden /></span>
                  <span className={styles.flowText}>
                    <span className={styles.flowName} title={kind.name}>{kind.name}</span>
                    {kind.note ? <span className={styles.flowNote} title={kind.note}>{kind.note}</span> : null}
                  </span>
                  <span className={styles.flowTiming}>{timingLabel(flow)}</span>
                  <span className={styles.flowStatus}><StatusBadge tone="neutral">{flow.delivery_mode === 'disabled' ? '送信しない' : '確認用'}</StatusBadge></span>
                </button>
              </Card>
              {isSelected && draft ? <FlowEditor key={flow.id} flow={flow} name={kind.name} draft={draft} readOnly={readOnly} busy={busy}
                onChange={next => setDrafts(current => ({ ...current, [flow.id]: next }))} /> : null}
            </div>
          })}
        </div>
      </DetailColumns>
    </>
  )
}

export default function LineFollowupV8() {
  const { selectedAccountId } = useAccount()
  const [selectedId, setSelectedId] = useState('')
  const [drafts, setDrafts] = useState<Drafts>({})
  const [draftAccount, setDraftAccount] = useState(selectedAccountId)
  if (draftAccount !== selectedAccountId) {
    setDraftAccount(selectedAccountId)
    setDrafts({})
    setSelectedId('')
  }
  const role = useStaffRole()
  const readOnly = !canManageRole(role)
  const save = (ctx: RestaurantContext) => {
    const flows = flowsOf(ctx)
    const selected = flows.find(flow => flow.id === selectedId) ?? flows[0]
    if (!selected || !selectedAccountId) return
    const draft = drafts[selected.id] ?? { title: selected.title, body: selected.body }
    void ctx.mutate(() => restaurantTestApi.updateLineFlow(selectedAccountId, selected.id, draft), '下書きを保存しました。送信はまだ行いません。')
  }
  return (
    <RestaurantFrame
      boardId="n9vvGx"
      title="LINE来店フォロー"
      description="予約前・来店後・口コミ依頼・会員証を、来店・退店のきっかけで送るひな形として作ります。"
      pickerAs="select"
      banner={false}
      subtitle={(store) => `${store ? `${store.name} ・ ` : ''}本送信は停止中（プレビューのみ）`}
      actions={(ctx) => readOnly ? null : (
        <Button variant="primary" disabled={!ctx || ctx.busy || flowsOf(ctx).length === 0} busy={ctx?.busy} onClick={() => { if (ctx) save(ctx) }}>
          <Check size={16} aria-hidden />下書きを保存する
        </Button>
      )}
    >
      {(ctx) => <LineFollowupBoard ctx={ctx} selectedId={selectedId} setSelectedId={setSelectedId} drafts={drafts} setDrafts={setDrafts} readOnly={readOnly} />}
    </RestaurantFrame>
  )
}
