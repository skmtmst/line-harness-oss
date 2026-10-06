import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * 2026-10-06 点検：V8 シナリオ一覧（src/v8/scenarios/list.tsx）の表示件数が、決まりの部品
 * PageSizeSelect（監査 #668）を使わず素の Select で組まれていた。部品へ寄せたことを見張る。
 * 選択肢は今までどおり 20・50・100。
 */
const source = readFileSync(new URL('./list.tsx', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(?<!:)\/\/[^\n]*/g, '')

describe('V8 シナリオ一覧の表示件数', () => {
  it('表示件数は共通の PageSizeSelect で出す', () => {
    expect(source).toContain("import PageSizeSelect from '@/components/ui/page-size-select'")
    expect(source).toMatch(/<PageSizeSelect\b[^>]*value=\{perPage\}[^>]*onChange=\{setPerPage\}/)
  })

  it('素の Select で件数の箱を組まない', () => {
    expect(source).not.toContain('aria-label="1ページに出す件数"')
    expect(source).not.toMatch(/<Select\b[^>]*size="page-size"/)
  })

  it('選択肢は 20・50・100 のまま', () => {
    expect(source).toContain('const PAGE_SIZE_OPTIONS = [20, 50, 100]')
    expect(source).toMatch(/<PageSizeSelect\b[^>]*options=\{PAGE_SIZE_OPTIONS\}/)
  })
})
