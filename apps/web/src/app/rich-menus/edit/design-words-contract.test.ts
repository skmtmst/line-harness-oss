import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('../new/create-v8.tsx', import.meta.url), 'utf8')

describe('リッチメニュー編集中の表示', () => {
  it('選択中の面だけの動きを編集し、面の名前を示す', () => {
    expect(PAGE).toContain('selectedArea && activeIndex >= 0 ? (')
    expect(PAGE).toContain('area={selectedArea}')
    expect(PAGE).toContain('areaDisplayName(selectedArea, activeIndex)')
  })
})
