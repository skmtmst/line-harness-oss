import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, '../../../v8/rich-menus/connections.tsx'), 'utf8')
const LIST = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8')

describe('V8 リッチメニューの切替つながり', () => {
  it('現役の板へ同じ実データから切替先の有無を描く', () => {
    expect(PAGE).toContain('boardId="wxIQ7"')
    expect(PAGE).toContain('others.length > 0')
    expect(PAGE).toContain('切替先を足すと、ここに')
  })

  it('既存のgroup取得だけを使い、切替数を固定値で作らない', () => {
    expect(PAGE).toContain('api.richMenuGroups.get(groupId)')
    expect(PAGE).toContain('analysis.edges.filter((edge) => edge.fromPageId === pageId)')
    expect(PAGE).not.toContain('切替ボタン" value="5件')
  })

  it('選択中アカウントと所属アカウントが違う場合は表示しない', () => {
    expect(PAGE).toContain('group.accountId !== selectedAccountId')
    expect(PAGE).toContain('kind="forbidden"')
  })

  it('アカウント切替後に届いた古い取得結果を表示しない', () => {
    expect(PAGE).toContain('activeAccountIdRef.current !== accountId')
    expect(PAGE).toContain('requestGenerationRef.current !== generation')
    expect(PAGE).toContain('setGroup(null)')
  })

  it('読込・空・失敗と実値0を混ぜない', () => {
    expect(PAGE).toContain('kind="loading"')
    expect(PAGE).toContain('kind="empty"')
    expect(PAGE).toContain('kind="error"')
    expect(PAGE).toContain('onRetry={() => void load()}')
  })

  it('一覧から切替のつながりへ進める', () => {
    expect(LIST).toContain('/rich-menus/connections?id=')
    expect(LIST).toContain('切替のつながりを見る')
  })
})
