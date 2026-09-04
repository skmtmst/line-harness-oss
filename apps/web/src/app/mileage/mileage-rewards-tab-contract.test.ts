/*
 * `qlVLJ`（17-1-B マイルの使い道）で守りたいこと。
 *
 * この面の数字は、**運用者が「誰に声をかけるか」を決めるために見る**。
 * 取れていない数を 0 と書くと、声をかける相手を取り違える。
 * `/api/mileage/rewards` の `neverRedeemedFriendCount` は **いまは必ず null**
 * （`packages/db/src/mileage-rewards.ts` が固定で null を返す）なので、
 * ここが 0 に化ける書き方を入れると、**必ず**嘘が出る。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const TAB = readFileSync(join(__dirname, 'mileage-rewards-tab.tsx'), 'utf8')
const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8')

/** 説明の文は「そう書いてある」だけで通ってしまうので、判定の前に落とす。 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('マイルの使い道', () => {
  const code = withoutComments(TAB)

  it('取れていない人数を 0 で埋めない', () => {
    // `?? 0` で埋めると「1回も使っていない人 0人」＝全員が使った、と読める。
    expect(code).not.toMatch(/neverRedeemedFriendCount\s*\?\?\s*0/)
    // null のときは `—` を出す道が要る。
    expect(code).toMatch(/neverRedeemedFriendCount\s*==\s*null/)
    expect(code).toContain('—')
  })

  it('引換コードの残りを 0 で埋めない', () => {
    expect(code).not.toMatch(/availableCodeCount\s*\?\?\s*0/)
    expect(code).toMatch(/availableCodeCount\s*===\s*null/)
  })

  it('内部の記号をそのまま画面に出さない', () => {
    // `coupon` `early_access` などは、日本語の言い換えを通してから出す。
    expect(code).toMatch(/KIND_LABEL/)
    for (const kind of ['coupon', 'tag', 'scenario', 'template', 'early_access', 'rank']) {
      expect(code).toContain(`${kind}:`)
    }
  })

  it('下書きを「準備中」と言わない', () => {
    expect(code).not.toContain('準備中')
  })

  it('返事の形を確かめてから並べる', () => {
    // 配列でないものを map すると一覧ごと落ちる。
    expect(code).toMatch(/Array\.isArray\(response\.data\?\.rewards\)/)
  })

  it('読み込み・権限・失敗のそれぞれに出す文がある', () => {
    for (const state of ['loading', 'forbidden', 'error']) {
      expect(code).toContain(`status === '${state}'`)
    }
  })
})

describe('マイルのタブ', () => {
  it('使い道のタブがあり、開くと使い道の面が出る', () => {
    // タブの鍵が無いと `?tab=rewards` は既定タブへ落ち、
    // 画面からは「無い」ことすら分からない。
    expect(PAGE).toMatch(/key:\s*'rewards'/)
    expect(withoutComments(PAGE)).toMatch(/tab === 'rewards'/)
  })

  it('使い道の面はアカウントごとに読む', () => {
    // アカウントを渡さないと、ほかの店の使い道まで混ざる。
    expect(PAGE).toMatch(/<MileageRewardsTab[\s\S]{0,120}accountId=/)
  })
})
describe('いちばん使われた', () => {
  const code = withoutComments(TAB)

  it('1回も交換されていないときは名指ししない', () => {
    // 名前を出すと「これがよく使われている」と読め、伸ばす先を取り違える。
    expect(code).toMatch(/mostRedeemedRewardCount\s*\?\s*summary\.mostRedeemedRewardName/)
    expect(code).toContain('まだ交換されていません')
  })

  it('数えられないときと0回を、同じ文にしない', () => {
    expect(code).toMatch(/mostRedeemedRewardCount\s*==\s*null/)
    expect(code).toMatch(/mostRedeemedRewardCount\s*===\s*0/)
  })
})
