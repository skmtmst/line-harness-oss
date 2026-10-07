import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/** EC連携の取り込みの記録（板 `nAesv`）の言葉を絵に合わせる歯止め。 */
describe('nAesv 取り込みの記録', () => {
  it('探す口を絵の言葉にする', () => {
    expect(PAGE).toContain('取り込みの記録を探す')
  })

  it('失敗と送信なしの訳を書く', () => {
    expect(PAGE).toContain('見送ったものは「送信なし」に入ります')
    expect(PAGE).toContain('送る設定がない')
    expect(PAGE).toContain('会員のつき合わせへ')
  })

  it('行ごとにやり直せる口を出す', () => {
    expect(PAGE).toContain('もう一度やる')
  })
})
