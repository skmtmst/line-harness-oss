import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

/** 注釈を落とす。「なぜ直したか」を書いた文が、直したはずの字面に当たるのを避ける。 */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const CODE = code(PAGE)

/**
 * 設計 `vUXKb` と突き合わせて見つけた3点。
 *
 * ① 送信枠が「197 / 200通」だけで、使用数か残りか読めない。
 *    この値は `limit - used`（＝残り）なので、言葉を付けて向きを固定する。
 * ② 「最も古い未対応：9,110分前」は、何日前か暗算しないと分からない。
 * ③ 並び順ラベルが「優先度順」で、他画面の「〜が多い順」「〜が新しい順」と揃っていない。
 */
describe('ダッシュボードの言葉を設計にそろえる', () => {
  it('送信枠は、使用数か残りかが分かる形で書く', () => {
    expect(CODE, '数字だけで向きが分からない').not.toMatch(/\$\{remaining\.toLocaleString\('ja-JP'\)\} \/ \$\{limit/)
    expect(CODE).toContain('残り ${remaining.toLocaleString(\'ja-JP\')} / 上限 ${limit.toLocaleString(\'ja-JP\')}通')
  })

  it('残りは limit - used から出す（向きを取り違えない）', () => {
    expect(CODE).toContain('const remaining = used !== null && limit !== null ? Math.max(0, limit - used) : null')
  })

  it('待ち時間は読める単位で言う', () => {
    expect(CODE, '分のまま出している').not.toContain("`${oldestWaitMinutes.toLocaleString('ja-JP')}分前`")
    expect(CODE).toContain('humanWait(oldestWaitMinutes)')
    expect(CODE).toContain('if (minutes < 60) return `${minutes}分前`')
    expect(CODE).toContain('if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}時間前`')
    expect(CODE).toContain('return `${Math.floor(minutes / (60 * 24))}日前`')
  })

  it('並び順ラベルは他画面と同じ言い方にする', () => {
    expect(CODE, '「優先度順」のまま').not.toContain('>優先度順<')
    expect(CODE).toContain('優先度が高い順')
  })
})
