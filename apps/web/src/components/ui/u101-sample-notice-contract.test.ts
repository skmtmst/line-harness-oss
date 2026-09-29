import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const NOTICE = readFileSync(new URL('./sample-screen-notice.tsx', import.meta.url), 'utf8')

/**
 * #975 U101: 固定データの比較画面は、直リンクで開いても
 * 「見本」と分かり、通常画面への戻り口を持つ。
 */
describe('見本画面の明示（#975 U101）', () => {
  it('帯に「見本」と戻り口がある', () => {
    expect(NOTICE).toContain('role="note"')
    expect(NOTICE).toContain('data-sample-screen')
    expect(NOTICE).toContain('の見本です')
    expect(NOTICE).toContain('固定の例データを表示しています')
  })

  it('比較・検証画面がこの帯を持つ', () => {
    for (const path of [
      'app/visual-qa/friend-attributes/page.tsx',
      'app/visual-qa/friend-attributes-v2/page.tsx',
      'app/visual-qa/friend-attributes-v3/page.tsx',
    ]) {
      const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
      expect(source, path).toContain("from '@/components/ui/sample-screen-notice'")
      expect(source, path).toContain('SampleScreenNotice')
    }
  })

  it('比較画面は通常メニュー（lib/menu）に載っていない', () => {
    const menu = readFileSync(new URL('../../lib/menu.ts', import.meta.url), 'utf8')
    expect(menu).not.toContain('/tags-v3')
    expect(menu).not.toContain('/visual-qa')
  })
})
