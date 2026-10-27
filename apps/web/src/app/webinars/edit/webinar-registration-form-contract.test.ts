import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, '../../../v8/webinar-edit/cta.tsx'), 'utf8') + fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

/*
 * ウェビナーの申込フォーム選択。候補・状態・保存・断られたとき・CTA との区別は
 * registration-form-react.test.tsx が描いて押して見る。公開前確認の form_active は
 * Worker の webinars.test.ts が口を呼んで見る。ここは外への送信を足さない見張りだけ。
 */
describe('N-113 ウェビナーの申込フォーム選択の契約', () => {
  it('外部への送信を足さない（保存と取得だけ）', () => {
    /* この段の送信先は editor の保存だけ。LINE・顧客・カレンダーへ送らない。 */
    expect(PAGE).not.toContain('/api/meet-consultations')
    expect(PAGE).not.toContain('X-Line-Harness-Source')
  })
})
