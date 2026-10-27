import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ANALYTICS = fs.readFileSync(path.join(__dirname, '../../../v8/webinar-edit/analytics.tsx'), 'utf8')
const PAGE = fs.readFileSync(path.join(__dirname, '../../../v8/webinar-edit/edit.tsx'), 'utf8')

/*
 * V8 ウェビナー編集の集計の遅延読み込み。詳細の段を開いたときだけ1回取り、子が親の集計を出すことは
 * webinar-edit-contract-react.test.tsx と v8/webinar-edit/edit.test.tsx が数えて見る。
 * 参加者の続き読みは webinar-unsaved-flow-react.test.tsx（201人）、分類の取り直しは participants-v8-react.test.tsx、
 * 視聴者コメントの取得は viewer-comments-react.test.tsx が見る。
 */
describe('V8 ウェビナー編集の集計の遅延読み込みの契約', () => {
  it('コメントは参加者・集計と一緒に取らない（片方の失敗でもう片方を消さない・DETAIL-07）', () => {
    expect(PAGE).not.toContain('Promise.all([webinarApi.userComments')
    expect(ANALYTICS.split('/** 視聴者コメント。')[0]).not.toContain('webinarApi.userComments(')
  })
})
