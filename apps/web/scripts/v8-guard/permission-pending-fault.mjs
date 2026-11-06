import assert from 'node:assert/strict'
import ts from 'typescript'

/** 開始タグの属性や式に依存せず、共通の待機本文に故障を1つだけ入れる。 */
export function injectPermissionPendingFault(source) {
  const ast = ts.createSourceFile('page-pending.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const openings = []
  const visit = node => {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === 'PageContent') openings.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(openings.length, 1, '故障を入れる共通の待機本文は1つ必要です')
  const index = openings[0].end
  const broken = source.slice(0, index) + '<h1 data-permission-pending-fault>権限を確認しています</h1>' + source.slice(index)
  assert.notEqual(broken, source, '共通の待機本文への故障注入が実際に起きること')
  return broken
}
