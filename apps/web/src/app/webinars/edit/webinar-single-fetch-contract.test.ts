import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, '../../../v8/webinar-edit/edit.tsx'), 'utf8')

/*
 * V8 ウェビナー通知・CTAの取得一本化。子の段が1回だけ取り、CTA の枚数を取得・保存の報告で親へ流すことは
 * webinar-edit-contract-react.test.tsx、通知の段を移っても取り直さないことは v8/webinar-edit/edit.test.tsx、
 * 親の下の帯から保存できることは webinar-unsaved-flow-react.test.tsx が見る。ここは親が取らない見張りだけ。
 */
describe('V8 ウェビナー通知・CTAの取得一本化の契約', () => {
  it('親は通知も CTA も取らない', () => {
    expect(PAGE).not.toContain('webinarApi.notifications(')
    expect(PAGE).not.toContain('webinarApi.ctas(')
  })
})
