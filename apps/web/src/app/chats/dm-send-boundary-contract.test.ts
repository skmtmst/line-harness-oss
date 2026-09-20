import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 個別送信パネル(DirectMessagePanel)の応答対象照合の契約試験(#979 A02-04)。
 *
 * 対象は `apps/web/src/app/chats/page.tsx` の DirectMessagePanel。
 * 同じパネルのまま相手(friendId)が切り替わっても state は残る。
 * 送信応答の成功・失敗は「送信を始めた相手」と今開いている相手が
 * 一致するときだけ画面へ反映しなければならない。照合しないと
 * A宛の失敗表示や送信済みの行がBの会話へ出る。
 */

const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8')

/**
 * `start` から `end` までを切り出す。**印が無ければ落とす。**
 * 印を消したまま試験が通ると、何も見ていない試験になる。
 */
function region(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  if (from < 0) throw new Error(`区間の始まりが見つかりません: ${start}`)
  const to = source.indexOf(end, from + start.length)
  if (to < 0) throw new Error(`区間の終わりが見つかりません: ${end}`)
  return source.slice(from, to)
}

const PANEL = region(PAGE, 'function DirectMessagePanel(', '/**\n * URL状態の友だちID')

describe('個別送信パネルの応答対象照合(#979 A02-04)', () => {
  it('いま開いている相手を描画ごとに同期し、送信開始時の相手を固定する', () => {
    expect(PANEL).toContain('const friendIdRef = useRef(friendId)')
    expect(PANEL).toContain('friendIdRef.current = friendId')
    expect(PANEL).toContain('const sendFriendId = friendId')
    // 送信口・冪等キーの署名も固定した相手で組み立てる。
    expect(PANEL).toContain('`/api/friends/${sendFriendId}/messages`')
    expect(PANEL).toContain("{ friendId: sendFriendId, messageType: 'text', content }")
  })

  it('成功・失敗のどちらの応答も送信時の相手と一致するときだけ画面へ出す', () => {
    const handleSend = PANEL.match(/const handleSend = async \(\) => \{[\s\S]*?\n  \}/)
    expect(handleSend).not.toBeNull()
    const body = handleSend![0]
    // 成功系(履歴への追加・入力の消去)と失敗系(理由表示)の両方に照合が要る。
    const guards = body.match(/aliveRef\.current && friendIdRef\.current === sendFriendId/g) ?? []
    expect(guards.length).toBeGreaterThanOrEqual(2)
    expect(body).toContain('setSendError(describeSendFailure(sendError))')
  })

  it('相手が変わった時点で前の相手の失敗表示を残さない', () => {
    expect(PANEL).toContain("useEffect(() => setSendError(''), [friendId])")
  })
})
