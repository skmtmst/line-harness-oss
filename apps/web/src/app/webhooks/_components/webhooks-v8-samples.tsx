'use client'

/*
 * ★V8-B 外部連携の見本（板 `SAUCs`）。
 *
 * v7 の器（`page.tsx` の `WebhookSamples`）とは別の器。見本の種類・
 * 作る導線は v7 と同じ（受け取る見本→受け取るタブ、送る見本→作る画面）。
 * 見本のタブの件数は並べる見本の数（受け取る5＋送る4）と同じ数（#980）。
 * v7 を直す必要が出たら `page.tsx` 側も同じ判断を入れる。
 */
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import styles from './webhooks-v8-samples.module.css'

/*
 * 受け取る設定の「どこから来るか」の見本（v7 の SOURCE_PRESETS と同じ）。
 * 値は今までどおりの文字列なので、口も保存の形も変えない。
 */
const SOURCE_PRESETS = [
  { value: 'line', label: 'LINE公式アカウント', hint: '友だち追加やメッセージの通知を受け取ります' },
  { value: 'booking', label: '予約サービス', hint: '予約の確定・変更・取り消しを受け取ります' },
  { value: 'form', label: 'アンケートツール', hint: '回答が届いたことを受け取ります' },
  { value: 'ec', label: 'ECサイト', hint: '注文や発送の知らせを受け取ります' },
  { value: 'payment', label: '決済サービス', hint: '支払いの成否を受け取ります' },
] as const

/*
 * 送る側の見本（v7 の OUTGOING_SAMPLES と同じ。一覧の表示文言とそろえている）。
 * 送り先の作成は /webhooks/new で行うので、ここでは行き先の案内だけ持つ。
 */
const OUTGOING_SAMPLES = [
  { event: 'friend_add', when: '友だちが追加されたとき', payload: '名前・追加日・流入元' },
  { event: 'form_submitted', when: 'フォームが送られたとき', payload: 'フォーム名・回答ID' },
  { event: 'booking_created', when: '予約が入ったとき', payload: '予約ID・メニュー・担当' },
  { event: 'ec.order.confirmed', when: '注文が確定したとき', payload: '注文番号・金額・お客様名' },
] as const

export const WEBHOOKS_V8_SAMPLES_COUNT = SOURCE_PRESETS.length + OUTGOING_SAMPLES.length

export default function WebhooksV8Samples() {
  /*
   * 見本からの作成も受け取り口・送り先の作成（R32）。口側が
   * `requireRole('owner')` で守っているので、統括でなければ
   * 作成ボタンは出さず、統括への依頼だけ出す。
   */
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
    <div className={styles.samples}>
      <Notice tone="info" className={styles.notice}>
        よくあるつなぎ方の見本です。使いたい見本を選ぶと、作成画面がその内容で開きます。
      </Notice>
      <div className={styles.grid}>
        {/* 板 `SAUCs` の節名（タブ名とそろえる）。 */}
        <section className={styles.card} aria-label="こちらで受け取る（どこから来るか）">
          <h2 className={styles.cardTitle}>こちらで受け取る（どこから来るか）</h2>
          <p className={styles.cardLead}>相手のサービスで起きたことをうちに取り込みます。</p>
          {canCreate ? (
            <ul className={styles.list}>
              {SOURCE_PRESETS.map((preset) => (
                <li key={preset.value} className={styles.item}>
                  <div className={styles.itemText}>
                    <strong className={styles.itemName}>{preset.label}</strong>
                    <span className={styles.itemHint}>{preset.hint}</span>
                  </div>
                  <Button variant="secondary" href={`/webhooks?tab=incoming&source=${preset.value}`}>
                    この見本で作る
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.cardLead}>受け取り口の作成は統括だけができます。必要なときは統括に頼んでください。</p>
          )}
        </section>
        <section className={styles.card} aria-label="こちらから送る（いつ・何を送るか）">
          <h2 className={styles.cardTitle}>こちらから送る（いつ・何を送るか）</h2>
          <p className={styles.cardLead}>うちで起きたことを相手のサービスに知らせます。</p>
          {canCreate ? (
            <>
              <ul className={styles.list}>
                {OUTGOING_SAMPLES.map((sample) => (
                  <li key={sample.event} className={styles.item}>
                    <div className={styles.itemText}>
                      <strong className={styles.itemName}>{sample.when}</strong>
                      <span className={styles.itemHint}>送るもの：{sample.payload}</span>
                      {/* 板 `SAUCs` の見本の名前（出来事の合言葉）。 */}
                      <span className={styles.itemHint}>名前：{sample.event}</span>
                    </div>
                    <Button variant="secondary" href={`/webhooks/new?event=${sample.event}`}>
                      送り先を作る
                    </Button>
                  </li>
                ))}
              </ul>
              <p className={styles.cardLead}>見本に書いたことだけを送ります。</p>
            </>
          ) : (
            <p className={styles.cardLead}>送り先の作成は統括だけができます。必要なときは統括に頼んでください。</p>
          )}
        </section>
      </div>
    </div>
  )
}
