'use client'

/*
 * ★V8 LINE来店フォロー（Pencil `xLpnS`）。
 *
 * 確認用の注意の帯 → 数6（フロー・4種の有無・本送信）→ 流れのカード2列
 * （頭：NEN RESTAURANT・流れの名前・プレビューのみ／左：タイトル・本文・配信・下書き保存／
 * 右：LINEでの見え方）→ LINE ミニアプリ連携。
 * データの口は今の画面と同じ（snapshot の lineFlows＋updateLineFlow）。保存しても送らない。
 * 閲覧のみ（変える権限が無い人）には「下書きを保存する」を置かない。動きは BEHAVIOR.md。
 */
import { useRef, useState } from 'react'
import { Eye, Utensils } from 'lucide-react'
import Button from '@/components/shared/button'
import StatusBadge from '@/components/shared/status-badge'
import { TextField } from '@/components/shared/text-field'
import { useAccount } from '@/contexts/account-context'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { restaurantTestApi, type RestaurantLineFlow, type RestaurantStore } from '@/lib/restaurant-test-api'
import RestaurantFrame, { type RestaurantContext } from '../common-a/frame'
import { Panel, Stat, StatRow } from '../common-a/parts'
import styles from './line-followup.module.css'

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

function FlowCard({ flow, store, ctx, readOnly }: { flow: RestaurantLineFlow; store: RestaurantStore | null; ctx: RestaurantContext; readOnly: boolean }) {
  const { busy, mutate } = ctx
  const { selectedAccountId } = useAccount()
  const [title, setTitle] = useState(flow.title)
  const [body, setBody] = useState(flow.body)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const kind = FLOW_KINDS[flow.flow_type]
  const name = kind?.title ?? OTHER_TITLES[flow.flow_type] ?? flow.flow_type
  const accountName = store?.line_account_name || store?.name || 'LINE公式アカウント'
  return (
    <section className={styles.flow} aria-label={name}>
      <div className={styles.flowHead}>
        <div className={styles.flowHeadText}>
          <p className={styles.kicker}>NEN RESTAURANT</p>
          <h2 className={styles.flowTitle}>{name}</h2>
        </div>
        <StatusBadge tone="warning">{flow.delivery_mode === 'disabled' ? '送信しない' : 'プレビューのみ'}</StatusBadge>
      </div>
      <div className={styles.flowBody}>
        <div className={styles.form}>
          <label className={styles.field}>
            <span className={styles.label}>タイトル</span>
            <TextField value={title} onChange={(event) => setTitle(event.target.value)} readOnly={readOnly} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>本文</span>
            {/* 絵の本文の枠は高さ56で文を上下の中央に置く。枠は外の箱が持ち、文の高さは中身なり。 */}
            <span className={styles.bodyBox} onClick={() => bodyRef.current?.focus()}>
              <textarea ref={bodyRef} value={body} onChange={(event) => setBody(event.target.value)} rows={1} readOnly={readOnly} className={styles.bodyInput} />
            </span>
          </label>
          <div className={styles.flowFoot}>
            <span className={styles.timing}>{timingLabel(flow)}</span>
            <span className={styles.spacer} aria-hidden="true" />
            {readOnly ? null : (
              <Button
                disabled={busy || !selectedAccountId}
                onClick={() => {
                  if (!selectedAccountId) return
                  void mutate(
                    () => restaurantTestApi.updateLineFlow(selectedAccountId, flow.id, { title, body }),
                    '下書きを保存しました。送信はまだ行いません。',
                  )
                }}
              >
                下書きを保存する
              </Button>
            )}
          </div>
        </div>
        <div className={styles.preview} aria-label="LINEでの見え方">
          <div className={styles.previewHead}>
            <span className={styles.previewIcon} aria-hidden="true">{accountName.slice(0, 1)}</span>
            <span className={styles.previewAccount}>{accountName}</span>
          </div>
          <div className={styles.rich}>
            <div className={`${styles.photo} ${flow.flow_type === 'reservation_2h' ? styles.photoB : flow.flow_type === 'post_visit' ? styles.photoC : flow.flow_type === 'review_request' ? styles.photoD : styles.photoA}`}><Utensils aria-hidden className={styles.photoIcon} /></div>
            <div className={styles.richText}>
              <p className={styles.richTitle}>{title || 'タイトル'}</p>
              <p className={styles.richBody}>{body || '本文'}</p>
            </div>
            <p className={styles.richAction}>予約内容を確認</p>
          </div>
        </div>
      </div>
    </section>
  )
}

function LineFollowupBoard({ ctx }: { ctx: RestaurantContext }) {
  const { data, store } = ctx
  const role = useStaffRole()
  const readOnly = role !== null && !canManageRole(role)
  const flows = data.lineFlows.filter((flow) => !store || !flow.store_id || flow.store_id === store.id)
  const has = (type: string) => flows.some((flow) => flow.flow_type === type)
  return (
    <>
      <div className={styles.caution} role="note">
        <Eye aria-hidden className={styles.cautionIcon} />
        <span>いまは「確認用」です。保存しても、お客さまへはまだ送りません。本当に送るのは、本送信の準備ができてから（司令塔の確認のあと）切り替えます。</span>
      </div>
      {readOnly ? (
        <div className={styles.readOnly} role="note"><Eye aria-hidden className={styles.cautionIcon} /><span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span></div>
      ) : null}
      <StatRow>
        <Stat size="small" label="フロー" value={`${flows.length}`} note="カードテンプレート" />
        {Object.entries(FLOW_KINDS).map(([type, kind]) => (
          <Stat key={type} size="small" label={kind.stat} value={has(type) ? '確認用' : '未作成'} note={kind.note} />
        ))}
        <Stat size="small" label="本送信" value="停止中" note="プレビューのみ" warning />
      </StatRow>
      <div className={styles.flowGrid}>
        {flows.map((flow) => <FlowCard key={flow.id} flow={flow} store={store} ctx={ctx} readOnly={readOnly} />)}
      </div>
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
      boardId="xLpnS"
      title="LINE来店フォロー"
      description="予約前・来店後・口コミ依頼・会員証をカード型で設計します。"
    >
      {(ctx) => <LineFollowupBoard ctx={ctx} />}
    </RestaurantFrame>
  )
}
