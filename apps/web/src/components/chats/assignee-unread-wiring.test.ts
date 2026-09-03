import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(__dirname, '..', '..', 'app', 'chats', 'page.tsx'), 'utf8')

/*
  **同じ文字列がファイル内に何度も出る。** `indexOf` を素で使うと、
  別の効果の閉じ括弧を掴んで、中身が空の切り出しになる（実際にそうなった）。
  この効果の始まりから、その後ろで最初に閉じるところまでを見る。
*/
const START = PAGE.indexOf('setAssigneeUnread(null)')
const EFFECT = PAGE.slice(START, PAGE.indexOf('}, [selectedAccountId])', START))

/**
 * 画面側の配線。**考え方が正しくても、繋いでいなければ効かない。**
 * 純粋関数の試験（`assignee-unread.test.ts`）と対で見る。
 */
describe('V6 担当者ごとの未読数（YZaDK）の配線', () => {
  it('選び口へ集計から引いた数を渡す', () => {
    /*
      **素の `select` へ戻さない。** 共通の `OperatorDropdown` に
      未読数の引き方だけを渡す（§1「使えない選び口を置かない」と、
      素の select を部品へ寄せる決めごとの両方に合わせる）。
    */
    expect(PAGE).toContain('unreadOf={unreadLookup(assigneeUnread)}')
    // 画面に見えている行から数えない（一覧はページ送りされる）。
    expect(PAGE).not.toContain('items.filter((item) => item.operatorId')
  })

  it('集計の口を読む', () => {
    expect(PAGE).toContain('api.chatStats.get()')
    // 契約に無い引数を足さない。
    expect(PAGE).not.toContain('api.chatStats.get(selectedAccountId')
  })

  it('アカウントを切り替えたら前の集計をその場で捨てる', () => {
    expect(PAGE).toContain('setAssigneeUnread(null)')
    expect(EFFECT).toContain('api.chatStats.get()')
    // 捨てるのは読みに行くより先。順番が逆だと前の数が残って見える。
    expect(EFFECT.indexOf('setAssigneeUnread(null)')).toBeLessThan(EFFECT.indexOf('api.chatStats.get()'))
    expect(PAGE).toContain('}, [selectedAccountId])')
  })

  it('失敗を0件と扱わず、数だけ — にする', () => {
    /*
      `null` のまま置く。0を入れると「誰にも未読が無い」と読める。
      担当者一覧そのものは `/api/operators` の結果を保つ。
    */
    expect(EFFECT).toContain("if (!res.success) throw new Error('failed')")
    expect(EFFECT).toContain('if (!cancelled) setAssigneeUnread(null)')
    expect(EFFECT).not.toContain('setOperators([])')
  })

  it('初期値は未取得であって0件ではない', () => {
    expect(PAGE).toContain("useState<InboxStats['assigneeUnread'] | null>(null)")
  })
})
