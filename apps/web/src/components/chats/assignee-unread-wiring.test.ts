import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(__dirname, '..', '..', 'app', 'chats', 'page.tsx'), 'utf8')

/**
 * 画面側の配線で**戻してはいけない形**だけを文字で見張る。
 * 数を集計から引く・失敗で「—」・切り替えで前の数を捨てる、は
 * assignee-unread-wiring-react.test.tsx が本物の画面で見る。
 */
describe("管理画面 担当者ごとの未読数（YZaDK）の配線で戻さない形", () => {
  it('画面に見えている行から数えない（一覧はページ送りされる）', () => {
    expect(PAGE).not.toContain('items.filter((item) => item.operatorId')
  })

  it('集計の口に契約に無い引数を足さない', () => {
    expect(PAGE).not.toContain('api.chatStats.get(selectedAccountId')
  })

  it('集計の失敗で担当者一覧そのものを空にしない', () => {
    expect(PAGE).not.toContain('setOperators([])')
  })
})
