import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PARTICIPANTS = fs.readFileSync(new URL('../../../v8/webinar-edit/participants.tsx', import.meta.url), 'utf8')
const ANALYTICS = fs.readFileSync(new URL('../../../v8/webinar-edit/analytics.tsx', import.meta.url), 'utf8')
const PAGE = fs.readFileSync(new URL('../../../v8/webinar-edit/edit.tsx', import.meta.url), 'utf8')

describe('V8 ウェビナー編集の集計の遅延読み込みの契約', () => {
  it('集計の取得口は親の段条件つき1か所だけ', () => {
    /* 子(AnalyticsTab)は集計を取らず、親から受け取る。 */
    expect(PAGE.match(/webinarApi\.analytics\(/g)).toHaveLength(1)
    expect(PAGE).toContain("if (!isDetailPane)")
  })

  it('参加者・分析の段に親の集計を渡す', () => {
    // 参加者と分析は、親で取得した集計を受ける。
    expect(PAGE).toContain('analyticsState,')
    expect(PAGE).toContain('<ParticipantsPane ctx={ctx}')
    expect(PAGE).toContain('<AnalyticsPane ctx={ctx}')
  })

  it('参加者一覧はカーソルで最後まで読め、コメントとは取り口を分ける', () => {
    // 参加者口は staff には 403 が返る(N-118)。403 を個別に捌く。
    // 一覧は nextCursor を辿って全員分まで読める。8件どまりに戻さない。
    expect(PARTICIPANTS).toContain('.participants(webinar.id, undefined, PARTICIPANTS_PAGE_SIZE, filter || undefined)')
    expect(PARTICIPANTS).toContain('webinarApi.participants(webinar.id, nextCursor, PARTICIPANTS_PAGE_SIZE, filter || undefined)')
    expect(PARTICIPANTS).toContain('loadMore')
    /*
      コメントは参加者・集計と一緒に取らない。片方の失敗でもう片方が
      消えないよう、Promise.all で束ねた取り方は無い（DETAIL-07）。
    */
    expect(PAGE).not.toContain('Promise.all([webinarApi.userComments')
    expect(PARTICIPANTS).not.toContain('webinarApi.userComments(')
    expect(ANALYTICS).toContain('function ViewerComments(')
    expect(ANALYTICS).toContain('void webinarApi.userComments(webinarId).then(')
    expect(ANALYTICS).toContain('視聴者コメントを読み込めませんでした。')
  })
})
