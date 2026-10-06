'use client'

/*
 * ★V8 外部連携「見本」タブ（Pencil `SAUCs`）。
 *
 * 受け取る見本5つ（どこから来るか）と送る見本4つ（いつ・何を送るか）を
 * カードで並べ、「この見本で作る」で作る画面へ進む。見本データは v7 と同じ。
 * 見本からの作成は統括だけ（R32）。閲覧のみの人には押せないボタンを置かない。
 */
import { CalendarDays, ClipboardList, CreditCard, LayoutTemplate, MessageCircle, ShoppingCart } from 'lucide-react'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useStaffRole } from '@/lib/staff-role'
import { ListPage } from '@/components/templates'
import Button from '@/components/shared/button'
import {
  ViewerBand,
  WEBHOOKS_DESCRIPTION,
  WebhookBand,
  WebhookTabs,
  overviewBandCells,
  useWebhookOverview,
} from './shell'
import styles from './samples.module.css'

/* 受け取る側の見本（どこから来るか）。 */
export const INCOMING_SAMPLES = [
  { value: 'line', label: 'LINE公式アカウント', hint: '友だち追加やメッセージの通知を受け取ります', icon: MessageCircle },
  { value: 'booking', label: '予約サービス', hint: '予約の確定・変更・取り消しを受け取ります', icon: CalendarDays },
  { value: 'form', label: 'アンケートツール', hint: '回答が届いたことを受け取ります', icon: ClipboardList },
  { value: 'ec', label: 'ECサイト', hint: '注文や発送の知らせを受け取ります', icon: ShoppingCart },
  { value: 'payment', label: '決済サービス', hint: '支払いの成否を受け取ります', icon: CreditCard },
] as const

/*
 * 送る側の見本（いつ・何を送るか）。R150: event は送り先が実際に購読できる種類
 * （packages/db KNOWN_OUTGOING_EVENT_TYPES）。作られない出来事を見本に書くと
 * 「すべての出来事を送る」設定が意図せず作られる。
 */
export const OUTGOING_SAMPLES = [
  { event: 'friend_add', when: '友だちが追加されたとき', payload: '名前・追加日・流入元' },
  { event: 'form_submitted', when: 'フォームが送られたとき', payload: 'フォーム名・回答ID' },
  { event: 'booking_created', when: '予約が入ったとき', payload: '予約ID・メニュー・担当' },
  { event: 'ec.order.confirmed', when: '注文が確定したとき', payload: '注文番号・金額・お客様名' },
] as const

export default function WebhooksSamplesV8() {
  usePageTitle('外部連携')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const staffRole = useStaffRole()
  const canManage = staffRole === null || staffRole === 'owner'
  const overview = useWebhookOverview()
  return (
    <ListPage
      boardId="SAUCs"
      headingSize="regular"
      title="外部連携"
      description={WEBHOOKS_DESCRIPTION}
      actions={canManage ? <Button href="/webhooks?tab=notify"><LayoutTemplate size={15} aria-hidden="true" />見本から作る</Button> : undefined}
      tabs={<WebhookTabs active="notify" outgoingCount={overview.outgoingCount} incomingCount={overview.incomingCount} />}
      stats={<>
        {!canManage ? <ViewerBand /> : null}
        <WebhookBand
          cells={overviewBandCells({
            outgoing: overview.outgoingCount === null ? null : overview.outgoing,
            incomingCount: overview.incomingCount,
            summary: overview.summary,
          })}
        />
      </>}
    >
      <div className={styles.body}>
        <section aria-label="こちらで受け取る見本" className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>こちらで受け取る（どこから来るか）</h2>
            <span className={styles.count}>{INCOMING_SAMPLES.length}</span>
            <span className={styles.spacer} aria-hidden="true" />
            <span className={styles.note}>見本に無いものは「その他」を選べば自由に書けます</span>
          </div>
          <ul className={styles.cards} data-cols="5">
            {INCOMING_SAMPLES.map((sample) => (
              <li key={sample.value} className={styles.card}>
                <div className={styles.cardHead}>
                  <sample.icon size={16} aria-hidden="true" />
                  <span>{sample.label}</span>
                </div>
                <p className={styles.cardDesc}>{sample.hint}</p>
                <span className={styles.cardSpacer} aria-hidden="true" />
                {canManage
                  ? <Button href={`/webhooks?tab=incoming&source=${sample.value}`} className={styles.cardButton}>この見本で作る</Button>
                  : <span className={styles.cardButtonSpace} aria-hidden="true" />}
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="こちらから送る見本" className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>こちらから送る（いつ・何を送るか）</h2>
            <span className={styles.count}>{OUTGOING_SAMPLES.length}</span>
          </div>
          <ul className={styles.cards} data-cols="4">
            {OUTGOING_SAMPLES.map((sample) => (
              <li key={sample.event} className={styles.card}>
                <div className={styles.cardHead}><span>{sample.when}</span></div>
                <dl className={styles.meta}>
                  <dt>送るもの</dt>
                  <dd>{sample.payload}</dd>
                </dl>
                <dl className={styles.meta}>
                  <dt>名前</dt>
                  <dd className={styles.code}>{sample.event}</dd>
                </dl>
                <span className={styles.cardSpacer} aria-hidden="true" />
                {canManage
                  ? <Button href={`/webhooks/new?event=${sample.event}`} className={styles.cardButton}>この見本で作る</Button>
                  : <span className={styles.cardButtonSpace} aria-hidden="true" />}
              </li>
            ))}
          </ul>
        </section>
        {!canManage ? <p className={styles.askNote}>見本から作るのは統括だけができます。必要なときは統括に頼んでください。</p> : null}
        <p className={styles.footNote}>見本に書いたことだけを送ります。「すべての出来事を送る」設定は見本からは作られません。</p>
      </div>
    </ListPage>
  )
}
