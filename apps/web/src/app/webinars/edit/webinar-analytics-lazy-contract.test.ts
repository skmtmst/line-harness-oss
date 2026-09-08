import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('V6 ウェビナー編集の集計の遅延読み込みの契約', () => {
  it('集計の取得口は親の段条件つき1か所だけ', () => {
    /* 子(AnalyticsTab)は集計を取らず、親から受け取る。 */
    expect(PAGE.match(/webinarApi\.analytics\(/g)).toHaveLength(1)
    expect(PAGE).toContain("if (pane !== 'participants' && pane !== 'analytics')")
  })

  it('参加者・分析の段に親の集計を渡す', () => {
    expect(PAGE.match(/analytics=\{analytics\} analyticsState=\{analyticsState\}/g)).toHaveLength(2)
  })

  it('子の独自取得はコメントと参加者だけ', () => {
    expect(PAGE).toContain('Promise.all([webinarApi.userComments(webinarId), webinarApi.participants(webinarId)])')
  })
})
