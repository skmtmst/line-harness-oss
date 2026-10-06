'use client'

/*
 * ★V8 LINE来店フォロー（板 `xLpnS`）。
 *
 * 完全切り替え：V8 だけで出す。v7（restaurant-console.tsx の LineFollowup）
 * は捨てた。データの口は同じ（snapshot の lineFlows＋updateLineFlow）。
 * 数の並び（フロー・4種の有無・本送信）→ 流れのカード（題・本文・配信・
 * 下書き保存・見え方の見本）→ LINEミニアプリ連携。
 */
import { useState } from 'react'
import Button from '@/components/shared/button'
import { useAccount } from '@/contexts/account-context'
import { restaurantTestApi, type RestaurantLineFlow } from '@/lib/restaurant-test-api'
import RestaurantShell, { Panel, Stat, type RestaurantV8Context } from './shell'
import shellStyles from './shell.module.css'
import styles from './line-followup.module.css'

/** 流れの種別の見せ名（板 `xLpnS`）。 */
const FLOW_NAMES: Record<string, { title: string; note: string }> = {
  reservation_24h: { title: '予約24時間前', note: '変更・取消導線' },
  reservation_2h: { title: '予約2時間前', note: '当日のご案内' },
  post_visit: { title: '来店後', note: 'お礼メッセージ' },
  review_request: { title: '口コミ依頼', note: 'Google への導線' },
}

function timingLabel(flow: RestaurantLineFlow): string {
  if (flow.timing_minutes === null) return '常設'
  if (flow.timing_minutes < 0) return `配信：${Math.abs(flow.timing_minutes) / 60}時間前`
  return `配信：${flow.timing_minutes / 60}時間後`
}

function FlowCard({ flow, ctx }: { flow: RestaurantLineFlow; ctx: RestaurantV8Context }) {
  const { busy, mutate } = ctx
  const { selectedAccountId } = useAccount()
  const [title, setTitle] = useState(flow.title)
  const [body, setBody] = useState(flow.body)
  const name = FLOW_NAMES[flow.flow_type]?.title ?? flow.flow_type
  return (
    <Panel title={name} flush>
      <div className={styles.flowInner}>
        <div>
          <label className={styles.field}>タイトル
            <input value={title} onChange={(event) => setTitle(event.target.value)} className={styles.input} />
          </label>
          <label className={styles.field}>本文
            <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} className={styles.input} />
          </label>
          <div className={styles.timingRow}>
            <span>{timingLabel(flow)}</span>
            <Button
              variant="secondary"
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
          </div>
        </div>
        <div className={styles.preview} aria-label="LINEでの見え方">
          <div className={styles.previewHead}>
            <p className={styles.previewBrand}>NEN RESTAURANT</p>
          </div>
          <div className={styles.previewBody}>
            <p className={styles.previewTitle}>{title || 'タイトル'}</p>
            <p className={styles.previewText}>{body || '本文'}</p>
            <p className={styles.previewAction}>予約内容を確認</p>
          </div>
        </div>
      </div>
    </Panel>
  )
}

function LineFollowupBoard({ ctx }: { ctx: RestaurantV8Context }) {
  const { data, store } = ctx
  const flows = data.lineFlows.filter((flow) => !store || !flow.store_id || flow.store_id === store.id)
  const has = (type: string) => flows.some((flow) => flow.flow_type === type)
  return (
    <>
      <div className={shellStyles.stats}>
        <Stat label="フロー" value={`${flows.length}`} note="カードテンプレート" />
        {(Object.keys(FLOW_NAMES) as Array<keyof typeof FLOW_NAMES>).map((type) => (
          <Stat
            key={type}
            label={FLOW_NAMES[type].title}
            value={has(type) ? '確認用' : '未作成'}
            note={FLOW_NAMES[type].note}
          />
        ))}
        <Stat label="本送信" value="停止中" note="プレビューのみ" warning />
      </div>
      <div className={styles.flowGrid}>
        {flows.map((flow) => (
          <FlowCard key={flow.id} flow={flow} ctx={ctx} />
        ))}
      </div>
      <Panel title="LINEミニアプリ連携" description="将来の切り離しを前提に、予約・会員証の境界を分離しています。">
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
    <RestaurantShell
      boardId="xLpnS"
      title="LINE来店フォロー"
      description="予約前・来店後・口コミ依頼・会員証をカード型で設計します。"
    >
      {(ctx) => <LineFollowupBoard ctx={ctx} />}
    </RestaurantShell>
  )
}
