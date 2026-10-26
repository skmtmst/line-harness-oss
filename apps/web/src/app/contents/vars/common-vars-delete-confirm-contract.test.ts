import { readUiSource } from '../../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readUiSource(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/*
 * 共通情報の削除確認（行の窓・まとめて削除）の動きは
 * `src/v8/common-vars/list-delete.test.tsx` が描いて押して守る。
 * ここはブラウザ標準の確認に戻さない禁止の見張りだけを残す。
 */
describe('共通情報の削除確認', () => {
  it('ブラウザ標準の確認に戻さない', () => {
    expect(PAGE).not.toContain('confirm(')
  })
})
