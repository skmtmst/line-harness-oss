import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const WEEKDAY = readFileSync(new URL('./weekday-select.tsx', import.meta.url), 'utf8')
const FRIENDS = readFileSync(new URL('./friend-multi-select.tsx', import.meta.url), 'utf8')

/*
 * R21・R22 の画面の契約。動き（保存・検証・権限）を守る試験は別にあり、
 * ここは「直しの形が残っているか」だけを見る。直しを戻すと赤くなる。
 */
describe('オートメーション作成の曜日・対象の直し（R21・R22）', () => {
  it('曜日は7つの札から選ぶ（数字の手入力はさせない）', () => {
    expect(PAGE).toContain('<WeekdaySelect')
    expect(WEEKDAY).toContain('動かす曜日')
    expect(WEEKDAY).toContain('WEEKDAY_OPTIONS')
    expect(WEEKDAY).toContain('曜日を1つ以上選んでください')
    expect(WEEKDAY).toContain('次は ')
  })

  it('余分なカンマが日曜に変わる形は残さない', () => {
    expect(PAGE).not.toContain('曜日番号（例: 1,3 は月・水）')
    expect(PAGE).not.toContain("split(',').map(Number)")
  })

  it('対象は名前で探して選ぶ（IDの手入力はさせない）', () => {
    expect(PAGE).toContain('<FriendMultiSelect')
    expect(FRIENDS).toContain('対象の友だち（')
    expect(FRIENDS).toContain('友だちを名前で探す')
    expect(FRIENDS).toContain('api.friends')
    expect(FRIENDS).toContain('.list({ accountId, search: word, limit: 20 })')
    expect(PAGE).toContain('対象の友だちを選んでください')
  })

  it('IDの手入力欄は残さない', () => {
    expect(PAGE).not.toContain('友だちID（複数はカンマ区切り')
  })

  it('保存にはIDと曜日だけを送り、名前は送らない', () => {
    expect(PAGE).toContain('normalizeWeekdays(triggerConfig.weekdays)')
    expect(PAGE).toContain('normalizeFriendIds(triggerConfig.friendIds)')
  })
})
