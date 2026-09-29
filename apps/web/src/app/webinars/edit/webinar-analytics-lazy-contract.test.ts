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

  it('参加者一覧はカーソルで最後まで読め、コメントとは取り口を分ける', () => {
    // 参加者口は staff には 403 が返る(N-118)。403 を個別に捌く。
    // 一覧は nextCursor を辿って全員分まで読める。8件どまりに戻さない。
    expect(PAGE).toContain('webinarApi.participants(webinarId, undefined, PARTICIPANTS_PAGE_SIZE, participantFilter || undefined)')
    expect(PAGE).toContain('webinarApi.participants(webinarId, nextCursor, PARTICIPANTS_PAGE_SIZE, participantFilter || undefined)')
    expect(PAGE).toContain('loadMoreParticipants')
    /*
      コメントは参加者・集計と一緒に取らない。片方の失敗でもう片方が
      消えないよう、Promise.all で束ねた取り方は無い（DETAIL-07）。
    */
    expect(PAGE).not.toContain('Promise.all([webinarApi.userComments')
    expect(PAGE.match(/webinarApi\.userComments\(/g)).toHaveLength(1)
  })
})
