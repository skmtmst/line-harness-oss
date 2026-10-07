'use client'

/*
 * ★V8-B 健康日記 記録の項目（z2tvtX）。項目ごとの 記録の形・選べる値・
 * 「気になる変化」に出る条件・30日のまとめでの扱い。変えられない決まりの一覧（数の帯の直下に表）。
 * 条件の数（8週・±10%・3回・30日）は Worker `services/nen-health-admin.ts` と同じ。
 */
import styles from './health.module.css'

const ITEM_ROWS: Array<{ item: string; shape: string; values: string; condition: string; summary: string }> = [
  { item: '体重', shape: '数値（kg）', values: '—', condition: '直近8週の週平均で、最初と最後の週を比べて ±10% 以上', summary: '「今日の目安」の元' },
  { item: '便', shape: '選ぶ', values: '正常／やわらかい／かたい／下痢／血が混じる／その他', condition: '直近3回がすべて 下痢 または 血が混じる', summary: '回数を出す' },
  { item: '食いつき', shape: '選ぶ', values: '良い／ふつう／不良', condition: '直近3回がすべて 不良', summary: '回数を出す' },
  { item: '皮膚', shape: '選ぶ', values: '問題なし／かゆそう／赤み／その他', condition: '—', summary: '回数を出す' },
  { item: '涙やけ', shape: '選ぶ', values: '問題なし／少し気になる／気になる', condition: '—', summary: '回数を出す' },
  { item: '呼吸数', shape: '数値（回／分）', values: '—', condition: '—', summary: '平均を出す' },
  { item: '心拍数', shape: '数値（回／分）', values: '—', condition: '—', summary: '平均を出す' },
  { item: 'メモ', shape: '文字', values: '—', condition: '—', summary: '新しい順で最大 20 件' },
  { item: '記録なし', shape: '—', values: '—', condition: '最後の記録から 30 日以上（注意ではなく、続けるきっかけ）', summary: '—' },
]

export default function HealthItemsV8() {
  return (
    <section aria-label="記録の項目">
      <div className={styles.itemTable} role="table" aria-label="記録の項目と条件">
        <div className={styles.itemHead} role="row">
          <span className={styles.itemName} role="columnheader">項目</span>
          <span className={styles.itemShape} role="columnheader">記録の形</span>
          <span className={styles.itemValues} role="columnheader">選べる値</span>
          <span className={styles.itemCondition} role="columnheader">「気になる変化」に出る条件</span>
          <span className={styles.itemSummary} role="columnheader">30日のまとめ</span>
        </div>
        {ITEM_ROWS.map((row) => (
          <div key={row.item} className={styles.itemRow} role="row">
            <span className={`${styles.itemName} ${styles.itemStrong}`} role="cell">{row.item}</span>
            <span className={styles.itemShape} role="cell">{row.shape}</span>
            <span className={styles.itemValues} role="cell">{row.values}</span>
            <span className={styles.itemCondition} role="cell">{row.condition}</span>
            <span className={styles.itemSummary} role="cell">{row.summary}</span>
          </div>
        ))}
      </div>
      <p className={styles.itemsNote}>項目と条件は決まっていて、ここでは変えられません。お客さまのマイページの記録と同じ並びです</p>
    </section>
  )
}
