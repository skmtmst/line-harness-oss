'use client'

import NoteBar from '@/components/shared/note-bar'

/** お客様がマイページ（★V6 37-2-B）で付ける項目。Worker `nen_health_logs` の列と同じ。 */
const ITEMS: Array<{ label: string; kind: string; detail: string }> = [
  { label: '体重', kind: '数値（kg）', detail: '「今日の目安」の元。8週で ±10% 以上変わると「気になる変化」に出ます。' },
  { label: '心拍数', kind: '数値（回／分）', detail: '30日のまとめで平均を出します。' },
  { label: '呼吸数', kind: '数値（回／分）', detail: '30日のまとめで平均を出します。' },
  { label: '便', kind: '正常／やわらかい／かたい／下痢／血が混じる／その他', detail: '下痢・血が混じる が3回続くと「気になる変化」に出ます。' },
  { label: '食いつき', kind: '良好／普通／不良', detail: '不良 が3回続くと「気になる変化」に出ます。' },
  { label: '皮膚', kind: '問題なし／かゆそう／赤み／その他', detail: '30日のまとめで回数を出します。' },
  { label: '涙やけ', kind: '問題なし／少し気になる／気になる', detail: '30日のまとめで回数を出します。' },
  { label: 'メモ', kind: '自由記入', detail: '30日のまとめに新しい順で最大20件を載せます。' },
]

const CHANGES: Array<{ label: string; rule: string }> = [
  { label: '体重 ±10%（8週）', rule: '直近8週の週平均体重で、最初の週と最後の週を比べて 10% 以上の増減' },
  { label: '便の異常が3回続く', rule: '直近3回の記録がすべて 下痢 または 血が混じる' },
  { label: '食いつき不良が3回続く', rule: '直近3回の記録がすべて 不良' },
  { label: '30日以上 記録なし', rule: '最後の記録から30日以上。注意ではなく「続けるきっかけ」の対象' },
]

/**
 * 記録の項目タブ。★V6 37-4（`mtoCA`）3つ目のタブ。表示だけ。
 * お客様が付ける項目と、「気になる変化」を出す決まりを説明する。
 */
export default function ItemsTab() {
  return (
    <>
      <div data-design="Note" data-design-node="health-items-note">
        <NoteBar tone="info">
          項目の追加・変更は設定ではなくアプリの更新で行います。ここは「何を記録して、どう気づきに変えるか」の説明です。
        </NoteBar>
      </div>
      <div data-design="Body" data-design-node="health-items-body" className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-card border border-hairline bg-canvas p-5">
          <h2 className="text-label font-bold text-ink">お客様が記録する項目</h2>
          <dl className="mt-3 flex flex-col gap-3">
            {ITEMS.map((item) => (
              <div key={item.label} className="flex flex-col gap-1 border-t border-hairline pt-3">
                <dt className="text-label font-semibold text-ink">{item.label} <span className="text-micro font-normal text-ink-faint">{item.kind}</span></dt>
                <dd className="text-caption text-ink-secondary">{item.detail}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="rounded-card border border-hairline bg-canvas p-5">
          <h2 className="text-label font-bold text-ink">「気になる変化」の決まり</h2>
          <dl className="mt-3 flex flex-col gap-3">
            {CHANGES.map((item) => (
              <div key={item.label} className="flex flex-col gap-1 border-t border-hairline pt-3">
                <dt className="text-label font-semibold text-ink">{item.label}</dt>
                <dd className="text-caption text-ink-secondary">{item.rule}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-caption text-ink-faint">医療判断はしません。気になる変化は「獣医師に相談するきっかけ」として使ってください。</p>
        </section>
      </div>
    </>
  )
}
