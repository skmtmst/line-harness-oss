import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/*
 * D010: 一覧の詳細パネルの×は素のテキストだけで、読み上げでは無名ボタンに
 * なる。共通の閉じるボタン（Drawer/ConfirmDialog と同じ
 * `aria-label="閉じる"`）を使う。見た目だけの×は残さない。
 */
describe('テンプレート一覧の詳細パネルの閉じるボタン（D010）', () => {
  it('共通の IconButton を使っている', () => {
    expect(PAGE).toContain("from '@/components/shared/icon-button'")
  })

  it('閉じるボタンに読み上げ用の名前がある', () => {
    expect(PAGE).toContain('aria-label="閉じる"')
  })

  it('素の×テキストのボタンは残っていない', () => {
    // `=>` の `>` で止まるので `[^>]*` は使わない。
    expect(PAGE.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/<button[\s\S]*?>\s*×\s*<\/button>/)
  })
})
