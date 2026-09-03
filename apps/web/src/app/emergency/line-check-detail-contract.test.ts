import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

/** LINE接続の項目を積む場所だけを切り出す。ほかの5項目に当たらないようにする。 */
function lineCheckPush(): string {
  const at = PAGE.indexOf('const undeterminedCount')
  if (at < 0) return ''
  const end = PAGE.indexOf('})', PAGE.indexOf("id: 'line'", at))
  return PAGE.slice(at, end)
}

/**
 * 検証環境（`3a21ef5e`）で、6項目のうちLINE接続だけ本文とバッジが逆だった：
 *
 *   LINE接続   本文「…確認しました（3アカウント）」        バッジ 未確認
 *   月間配信数 本文「月間配信数を取得できませんでした」      バッジ 未確認
 *   友だち変化 本文「友だちの日次変化を取得できませんでした」  バッジ 未確認
 *
 * 下2つは本文もバッジも「取れなかった」で揃っている。
 * `lineSeverity` は `normal`/`warning`/`danger` のどれでもない危険度が
 * 1つでもあると `unknown` に落ちるのに、本文は「アカウントが0件かどうか」
 * だけで分けていたため、判定できなかったときも「確認しました」と書いていた。
 */
describe('運用状態のLINE接続は、バッジと違うことを言わない', () => {
  it('判定できなかった件数を数えている', () => {
    expect(PAGE).toContain('const undeterminedCount = risks.filter((risk) =>')
    expect(PAGE).toContain("risk !== 'normal' && risk !== 'warning' && risk !== 'danger'")
  })

  it('判定できなかったときは「確認しました」と書かない', () => {
    const block = lineCheckPush()
    expect(block, 'LINE接続を積む場所が見つからない').not.toBe('')
    expect(block).toContain('undeterminedCount > 0')
    expect(block).toContain('件は接続状態を判定できませんでした')
  })

  it('すべて判定できたときだけ「確認しました」と書く', () => {
    const block = lineCheckPush()
    const confirmedAt = block.indexOf('LINE APIの認証エラーと接続状態を確認しました')
    const branchAt = block.indexOf('undeterminedCount > 0')
    expect(confirmedAt, '確認しましたの文が無い').toBeGreaterThan(-1)
    expect(branchAt, '判定できなかったときの分岐が先に無い').toBeGreaterThan(-1)
    expect(branchAt, '分岐より先に確認しましたを書いている').toBeLessThan(confirmedAt)
  })
})
