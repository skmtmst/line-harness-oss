import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
const CONTROL = readFileSync(join(__dirname, '../../../components/shared/folder-color-button.tsx'), 'utf8')
describe('V8フォルダの色', () => {
 it('色と別に選択状態を読み上げ、キーボードでも選べる', () => {
  expect(CONTROL).toContain('role="radio"')
  expect(CONTROL).toContain('aria-checked={selected(item)}')
  expect(CONTROL).toContain("'ArrowRight'")
 })
})
