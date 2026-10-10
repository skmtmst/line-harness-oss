import { readUiSource as readFileSync } from '../../../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'
const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
describe('V8友だち情報欄の種類選択', () => {
 it('種類の名前と用途を分け、選択状態を読み上げる', () => {
  expect(PAGE).toContain('FIELD_TYPE_WORDS')
  expect(PAGE).toContain('TYPE_HINTS')
  expect(PAGE).toContain('aria-checked={effectiveType === item}')
  expect(PAGE).toContain('SECONDARY_TYPES.map')
 })
})
