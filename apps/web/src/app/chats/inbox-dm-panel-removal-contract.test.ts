import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * TECH-06 / PERF-02: 旧 DirectMessagePanel と selectedFriendId の除去を見張る。
 *
 * 旧パネルは `setSelectedFriendId` が常に null しか入れず到達不能だった。
 * 到達経路が無いのに残っていると、パネルを開くときだけ走る
 * 「友だち800件の取得」が条件付きで残り続ける。未会話の友だちへの送信は
 * `?friend=` の深いリンク → 会話画面（chatId = friendId）で既にできるため、
 * パネルと800件取得はまとめて消した。
 *
 * この試験は「新しい受信箱実装に古い経路が紛れて戻らない」ことだけを見る。
 */
const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8')

describe('旧個別送信パネルの除去（TECH-06 / PERF-02）', () => {
  it('DirectMessagePanel と selectedFriendId が残っていない', () => {
    expect(PAGE).not.toContain('DirectMessagePanel')
    expect(PAGE).not.toContain('selectedFriendId')
  })

  it('800件の友だち一括取得が残っていない', () => {
    expect(PAGE).not.toContain("limit: '800'")
    expect(PAGE).not.toContain('loadAllFriends')
  })

  it('未会話の友だちへの送信導線（?friend= 深いリンク）は残る', () => {
    // 友だち詳細・予約・ウェビナー等からの /chats?friend=<id> が会話を開く。
    expect(PAGE).toContain("params.get('friend')")
    expect(PAGE).toContain('setSelectedChatId(rawFriend)')
  })
})
