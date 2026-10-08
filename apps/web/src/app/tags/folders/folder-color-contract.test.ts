import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
const PAGE = readFileSync(join(__dirname, '../../../v8/tags/folder-page.tsx'), 'utf8')
const CONTROL = readFileSync(join(__dirname, '../../../components/shared/folder-color-button.tsx'), 'utf8')
describe('V8フォルダの色', () => {
 it('色を名前で読み上げ、既定は緑', () => {
  expect(CONTROL).toContain('aria-label={item.name}')
  for (const name of ['緑','青','水色','紫','ピンク','赤','黄','グレー']) expect(PAGE).toContain(`name: '${name}'`)
  expect(PAGE).toContain('const DEFAULT_COLOR = TAG_FOLDER_COLORS[3].value')
  expect(PAGE).toContain("{ value: '#06C755', name: '緑' }")
 })
 it('色と別に選択状態を読み上げ、キーボードでも選べる', () => {
  expect(CONTROL).toContain('role="radio"')
  expect(CONTROL).toContain('aria-checked={selected(item)}')
  expect(CONTROL).toContain("'ArrowRight'")
 })
})
