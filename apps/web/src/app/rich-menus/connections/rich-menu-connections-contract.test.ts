import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(new URL('../../../v8/rich-menus/connections.tsx', import.meta.url), 'utf8')
const LIST = fs.readFileSync(new URL('../../../v8/rich-menus/list.tsx', import.meta.url), 'utf8')

describe('V8 リッチメニューの切替つながり', () => {
  it('接続先は実際のメニューから判定し、切替のないタブも表示する', () => {
    expect(PAGE).toContain('boardId="wxIQ7"')
    expect(PAGE).toContain('const others = pages.filter((page) => page.id !== entryId)')
    expect(PAGE).toContain('analysis.edges.filter((edge) => edge.fromPageId === entryId)')
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
