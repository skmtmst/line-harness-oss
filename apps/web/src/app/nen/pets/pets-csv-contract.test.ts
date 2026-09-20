import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/**
 * #999 DEEP-25: ペットCSVの数式インジェクション対策は共通 csvCell へ統合。
 * 画面ローカルの csvCell（引用符エスケープのみ、先頭 = が残る）は置かない。
 * #999 DEEP-24: 種類は共通の動物種別ラベル。「その他」を犬へ変換しない。
 */
describe('マイペットCSVの安全性（#999 DEEP-25）', () => {
  it('セルの整形は共通 csvCell（@/lib/presentation）を使う', () => {
    expect(PAGE).toContain("import { csvCell } from '@/lib/presentation'")
    expect(PAGE).not.toContain('function csvCell')
  })

  it('種類は共通の動物種別ラベルを使う', () => {
    expect(PAGE).toContain('petAnimalTypeLabel')
  })
})
