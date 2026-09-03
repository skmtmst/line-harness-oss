import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const LIST = fs.readFileSync(path.join(__dirname, 'field-list.tsx'), 'utf8')

/** 注釈を落とす。直した理由を書いた文が、自分の見張りに当たらないように。 */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const CODE = code(LIST)

/**
 * 設計 `HBTk0` と実装の文字を並べて見つけた。
 * 画面に**そのまま `undefined`** が出ていた（「使用中 undefined件」）。
 *
 * 元は2つ。
 *   ① 固定データの口 `/api/friend-fields-stats` がモックに無く、
 *      既定の器が返って `inUse` が入っていなかった。
 *   ② 画面が `summary` の有無だけ見て、中身の型を見ていなかった。
 *      型は `inUse: number` だが、返事が形どおりとは限らない。
 */
describe('友だち情報欄の帯', () => {
  it('値が無いとき、数のかわりに undefined を出さない', () => {
    expect(CODE, 'summary があるかだけで数を語っている').not.toContain('summary ? `使用中 ${summary.inUse}件` : ')
    expect(CODE).toContain("typeof summary?.inUse === 'number' ? `使用中 ${summary.inUse}件` : '使用中の数は取得できません'")
  })

  it('取れていないことを、0件と言い分ける', () => {
    expect(CODE).toContain('使用中の数は取得できません')
    expect(CODE, '取れないのを0と書かない').not.toContain('summary?.inUse ?? 0')
  })
})
