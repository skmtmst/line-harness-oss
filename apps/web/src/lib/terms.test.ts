import { describe, expect, it } from 'vitest'
import { bookingHost, styleTerm } from './terms'
import { planFeatureLabel } from './product-scope'
import { questionsFor } from '@/v8/onboarding/model'

describe('共通辞書を質問と説明の両方に使う', () => {
  it('面談・教室では受ける側と予約する人の言葉をそろえる', () => {
    for (const style of ['consult', 'lesson'] as const) {
      const approval = questionsFor(style).find((q) => q.key === 'approval')!
      expect(approval.choices[1].label).toContain(bookingHost(style))
      expect(approval.choices[1].note).toContain(bookingHost(style))
      expect(approval.description).toContain(styleTerm(style, 'V12').split('（')[0])
    }
  })
  it('人数・通数・容量だけを目安とし、画像の制限を目安にしない', () => {
    for (const feature of ['3アカウント', '10人', '権限者 無制限', '月30,000通', '容量10GB']) expect(planFeatureLabel(feature)).toContain('目安')
    expect(planFeatureLabel('画像 月20枚')).toBe('画像 月20枚')
    expect(planFeatureLabel('人数10人（目安）')).toBe('人数10人（目安）')
  })
})
