import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * 点検 #495 中7 の再発防止。
 *
 * 内容が空のまま保存を押すと、保存せず編集へ進むだけで何も言わなかった。
 * 書いたつもりが保存されていないのか、「あとで書く」を選んだのか
 * 区別できない。空のまま進む道は「1通目はあとで書く」ボタンに寄せ、
 * 保存ボタンは空なら理由を出して止める。
 */
describe('シナリオ1通目の空保存（点検 #495 中7）', () => {
  it('空のまま保存を押すと理由を出して止まる', () => {
    expect(PAGE).toContain('内容を入力してください。あとで書く場合は「1通目はあとで書く」を押してください。')
  })

  it('書かずに進む道は「1通目はあとで書く」ボタンに残す', () => {
    expect(PAGE).toContain('1通目はあとで書く')
  })
})
