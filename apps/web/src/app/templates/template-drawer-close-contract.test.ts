import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readUiSource(join(HERE, '../../v8/templates/list.tsx'), 'utf8')

/*
 * D010: 一覧の詳細パネルの×は素のテキストだけで、読み上げでは無名ボタンに
 * なる。共通の閉じるボタン（Drawer/ConfirmDialog と同じ
 * `aria-label="閉じる"`）を使う。見た目だけの×は残さない。
 *
 * 名前の付いた「閉じる」で閉じることは templates-list-behavior.test.tsx で押して確かめる。
 */
describe('テンプレート一覧の詳細パネルの閉じるボタン（D010）', () => {
  it('素の×テキストのボタンは残っていない', () => {
    // `=>` の `>` で止まるので `[^>]*` は使わない。
    expect(PAGE.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/<button[\s\S]*?>\s*×\s*<\/button>/)
  })
})
