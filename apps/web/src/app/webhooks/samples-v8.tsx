'use client'

/*
 * ★V8-B 外部連携の見本（板 `SAUCs`）。
 *
 * v7 の見本タブ（`page.tsx` の WebhookSamples）とは別の部品として持つ。
 * 並べる見本データ（受け取る5＋送る4）は v7 と同じ。見本に無い数は
 * 「—」ではなく件数（5・4・9）を出す——見本データから数える数なので
 * 口の不足ではない。タブ名とそろえ、節は「こちらで受け取る」
 * 「こちらから送る」と名付ける（申送り `SAUCs` の指摘）。
 * 頭と帯は送るタブと共用（`outgoing-v8` の部品）。
 * v7 を直す必要が出たら向こうも同じ判断を入れる（V8 完成までの二重管理）。
 */
import { Suspense, useEffect, useState } from 'react'
import { CalendarDays, ClipboardList, CreditCard, MessageCircle, ShoppingCart } from 'lucide-react'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import {
  WebhooksV8Band, WebhooksV8Head, outgoingKpiCells, useV8BandData,
} from './outgoing-v8'
import styles from './samples-v8.module.css'

/*
 * 受け取る側の見本（どこから来るか）。説明文は板 `SAUCs` の書き方にそろえる。
 * 見本からの作成は受け取り口の作成（R32）なので、統括でなければ
 * 作成ボタンは出さず、統括への依頼だけ出す。
 */
const INCOMING_SAMPLES = [
  { value: 'line', label: 'LINE公式アカウント', hint: '友だち追加やメッセージの通知を受け取ります', icon: MessageCircle },
  { value: 'booking', label: '予約サービス', hint: '予約の確定・変更・取り消しを受け取ります', icon: CalendarDays },
  { value: 'form', label: 'アンケートツール', hint: '回答が届いたことを受け取ります', icon: ClipboardList },
  { value: 'ec', label: 'ECサイト', hint: '注文や発送の知らせを受け取ります', icon: ShoppingCart },
  { value: 'payment', label: '決済サービス', hint: '支払いの成否を受け取ります', icon: CreditCard },
] as const

/*
 * 送る側の見本（いつ・何を送るか）。一覧の表示文言とそろえている。
 * R150: event は送信Webhookが実際に購読できる種類ID
 * (packages/db KNOWN_OUTGOING_EVENT_TYPES)。作られない出来事を
 * 見本に書くと「全イベント送信」の設定が意図せず作られる。
 */
const OUTGOING_SAMPLES = [
  { event: 'friend_add', when: '友だちが追加されたとき', payload: '名前・追加日・流入元' },
  { event: 'form_submitted', when: 'フォームが送られたとき', payload: 'フォーム名・回答ID' },
  { event: 'booking_created', when: '予約が入ったとき', payload: '予約ID・メニュー・担当' },
  { event: 'ec.order.confirmed', when: '注文が確定したとき', payload: '注文番号・金額・お客様名' },
] as const

function SamplesV8Body() {
  usePageTitle('外部連携')
  const { outgoingItems, incomingCount, summary } = useV8BandData()
  const [staffRole, setStaffRole] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void api.staff.me()
      .then((response) => {
        if (cancelled || !response.success) return
        setStaffRole(response.data.role)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  const canCreate = staffRole === null || staffRole === 'owner'
  return (
    <div className={styles.board} data-design-node="SAUCs">
      <WebhooksV8Head
        activeTab="notify"
        outgoingCount={outgoingItems ? outgoingItems.length : null}
        incomingCount={incomingCount}
      />
      <WebhooksV8Band
        cells={outgoingKpiCells({
          items: outgoingItems,
          incomingCount,
          summary,
        })}
      />
      <section className={styles.section} aria-label="こちらで受け取る見本">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>こちらで受け取る（どこから来るか） {INCOMING_SAMPLES.length}</h2>
          <p className={styles.sectionNote}>見本に無いものは「その他」を選べば自由に書けます</p>
        </div>
        {canCreate ? (
          <ul className={styles.cards}>
            {INCOMING_SAMPLES.map((sample) => (
              <li key={sample.value} className={styles.card}>
                <div className={styles.cardHead}>
                  <span className={styles.cardIcon} aria-hidden="true"><sample.icon size={14} /></span>
                  {sample.label}
                </div>
                <p className={styles.cardDesc}>{sample.hint}</p>
                <div className={styles.cardButton}>
                  <Button variant="secondary" href={`/webhooks?tab=incoming&source=${sample.value}`}>
                    この見本で作る
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.askNote}>受け取り口の作成は統括だけができます。必要なときは統括に頼んでください。</p>
        )}
      </section>
      <section className={styles.section} aria-label="こちらから送る見本">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>こちらから送る（いつ・何を送るか） {OUTGOING_SAMPLES.length}</h2>
        </div>
        {canCreate ? (
          <ul className={`${styles.cards} ${styles.cardsSend}`}>
            {OUTGOING_SAMPLES.map((sample) => (
              <li key={sample.event} className={styles.card}>
                <div className={styles.cardHead}>{sample.when}</div>
                <dl className={styles.cardMeta}>
                  <dt>送るもの</dt>
                  <dd>{sample.payload}</dd>
                </dl>
                <dl className={styles.cardMeta}>
                  <dt>名前</dt>
                  <dd>{sample.event}</dd>
                </dl>
                <div className={styles.cardButton}>
                  <Button variant="secondary" href={`/webhooks/new?event=${sample.event}`}>
                    この見本で作る
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.askNote}>送り先の作成は統括だけができます。必要なときは統括に頼んでください。</p>
        )}
      </section>
      <p className={styles.footNote}>
        見本に書いたことだけを送ります。「すべての出来事を送る」設定は見本からは作れません。
      </p>
    </div>
  )
}

export default function SamplesV8Page() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <SamplesV8Body />
    </Suspense>
  )
}
