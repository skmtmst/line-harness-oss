import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { readFileSync as readImplementation } from 'node:fs'
import ts from 'typescript'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/*
 * メディアの削除確認（設計 `YfTfJ` 15-1-C ／ 契約 #610）とまとめて削除（#550）の動きは、
 * src/v8/contents/list-delete.test.tsx が画面を描いて押し、API への要求と画面の変化で守る。
 * ここには禁止の見張りと、画面から確かめられない M3 の文の組み立てだけを残す。
 */
describe('メディアの削除確認（禁止の見張り）', () => {
  it('ブラウザ標準の確認窓で消させない', () => {
    expect(PAGE).not.toContain('confirm(`')
  })
})

/** まとめて削除（点検 #498 の M3／票 #550）。 */
describe('まとめて削除の結果', () => {
  const source = readImplementation(join(dirname(fileURLToPath(import.meta.url)), '../../v8/contents/list-bulk-delete.tsx'), 'utf8')
  const tree = ts.createSourceFile('list-bulk-delete.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'deleteMediaSelection')
  if (!declaration || !ts.isFunctionDeclaration(declaration) || !declaration.body) throw new Error('deleteMediaSelection が見つかりません')
  const bulkDelete = declaration.body.getText(tree)

  /*
   * 一部失敗の文は、画面ではすぐ後の一覧の読み直しが消してしまい、描いても見えない
   * （2026-10-26 に見つけた不具合。直すまで文字の確かめを残す）。
   */
  it('まとめて削除の結果は成功数と失敗した名前を1つの文にまとめる', () => {
    // 件ごとに上書きすると最後の1件しか残らない。
    expect(bulkDelete).toContain('summarizeBulkDeleteResult(deleted, failedNames)')
    expect(bulkDelete).toContain('failedNames.push(name)')
    expect(bulkDelete).not.toContain("setError('削除に失敗しました。通信を確かめて、もう一度お試しください。')")
  })
})
