import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(join(__dirname, 'single-friend-actions.tsx'), 'utf8')

/*
 * R117: 友だち個別操作の選択欄は、読み上げで何を変える欄か分かる
 * 固有の名前を持つ（WCAG 2.2 Name, Role, Value）。
 * 新しい選択欄・入力欄を足しても無名にしない。
 */
describe('R117 個別操作の選択欄・入力欄に読み上げ名がある', () => {
  it('すべての select に固有の読み上げ名がある', () => {
    const selects = SRC.match(/<select[^>]*>/g) ?? []
    expect(selects.length).toBeGreaterThan(0)
    for (const tag of selects) {
      expect(tag).toMatch(/aria-label="[^"]+"|aria-labelledby="[^"]+"/)
    }
    for (const name of ['対応状況', 'テンプレート', 'シナリオ', 'タグ', 'リマインダ']) {
      expect(SRC).toContain(`aria-label="${name}"`)
    }
  })

  it('すべての input に読み上げ名がある', () => {
    const inputs = SRC.match(/<input[^>]*>/g) ?? []
    expect(inputs.length).toBeGreaterThan(0)
    for (const tag of inputs) {
      expect(tag).toMatch(/aria-label="[^"]+"|aria-labelledby="[^"]+"/)
    }
  })
})
