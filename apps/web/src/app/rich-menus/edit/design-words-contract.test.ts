import { readUiSource } from '../../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

const PAGE = readUiSource(new URL('../../../v8/rich-menus/new/create.tsx', import.meta.url), 'utf8')

describe('リッチメニュー編集中の表示', () => {
  it('選択中の面だけの動きを編集し、面の名前を示す', () => {
    expect(PAGE).toContain('selectedArea && activeIndex >= 0 ? (')
    expect(PAGE).toContain('area={selectedArea}')
    expect(PAGE).toContain('areaDisplayName(selectedArea, activeIndex)')
  })
})
