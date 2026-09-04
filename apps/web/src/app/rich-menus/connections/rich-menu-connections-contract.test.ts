import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const LIST = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8')

describe('V6 リッチメニューの切替つながり', () => {
  it('DIUbOとNXdDkを同じ実データの有無で出し分ける', () => {
    expect(PAGE).toContain('data-design-node="DIUbO"')
    expect(PAGE).toContain('data-design-node="NXdDk"')
    expect(PAGE).toContain('analysis.edges.length === 0')
  })

  it('既存のgroup取得だけを使い、切替数を固定値で作らない', () => {
    expect(PAGE).toContain('api.richMenuGroups.get(groupId)')
    expect(PAGE).toContain('`${analysis.edges.length}件`')
    expect(PAGE).not.toContain('切替ボタン" value="5件')
  })

  it('選択中アカウントと所属アカウントが違う場合は表示しない', () => {
    expect(PAGE).toContain('group.accountId !== selectedAccountId')
    expect(PAGE).toContain('kind="forbidden"')
  })

  it('アカウント切替後に届いた古い取得結果を表示しない', () => {
    expect(PAGE).toContain('activeAccountIdRef.current !== accountId')
    expect(PAGE).toContain('requestGenerationRef.current !== requestGeneration')
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
