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
    expect(CODE).toContain('formatWaitRough(oldestWaitMinutes)')
  })

  /**
   * **同じ画面で同じ値を2通りに書かない。**
   * 一度は運用アラートだけ「6日前」に直し、すぐ上の「対応が必要な受信」は
   * 「6日7時間50分」のままにしていた。1枚の中で食い違っていた。
   */
  it('待ち時間の言い方は、画面の中で1つにそろえる', () => {
    expect(CODE, 'ダッシュボードの中で細かいほうを混ぜている').not.toContain('formatDurationMinutes(inboxSummary')
    const rough = [...CODE.matchAll(/formatWaitRough\(/g)].length
    expect(rough, '待ち時間を出す場所が2つとも粗いほうを使う').toBe(2)
  })

  it('待ち時間の整形は共通の場所に置く（画面ごとに書かない）', () => {
    const shared = code(fs.readFileSync(path.join(__dirname, '..', 'lib', 'format-duration.ts'), 'utf8'))
    expect(shared).toContain('export function formatWaitRough(minutes: number): string')
    expect(shared).toContain('if (total < 60) return `${total}分前`')
    expect(shared).toContain('if (total < 60 * 24) return `${Math.floor(total / 60)}時間前`')
    expect(shared).toContain('return `${Math.floor(total / (60 * 24))}日前`')
    expect(CODE, 'ダッシュボードの中に自前の整形を書かない').not.toContain('function humanWait')
  })

  it('並び順ラベルは他画面と同じ言い方にする', () => {
    expect(CODE, '「優先度順」のまま').not.toContain('>優先度順<')
    expect(CODE).toContain('優先度が高い順')
  })
})
