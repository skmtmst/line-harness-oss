import ts from 'typescript'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 表と行操作の描画の中だけを検査。メニュー・引き出しの編集は許す。 */
export function auditListSource(source, filename = 'screen.tsx') {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found = []
  const report = (node, rule) => found.push(`${filename}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: ${rule}`)
  const tag = (node) => ts.isJsxElement(node) ? node.openingElement.tagName.getText(ast) : ts.isJsxSelfClosingElement(node) ? node.tagName.getText(ast) : ''
  function visit(node, row = false, menu = false, name = false, folderName = false) {
    if (ts.isFunctionDeclaration(node) && /RowActions$/.test(node.name?.text ?? '') && node.name?.text !== 'RowActions') row = true
    const kind = tag(node)
    if (kind === 'FolderDotName') {
      if (folderName) report(node, 'B-194 名前の丸の重複')
      folderName = true
    }
    const attrs = ts.isJsxElement(node) ? node.openingElement.attributes : ts.isJsxSelfClosingElement(node) ? node.attributes : undefined
    if (['Tr', 'tr', 'GridRow'].includes(kind)) row = true
    if (kind === 'ActionMenu' || kind === 'RowMenu' || attrs?.getText(ast).includes('role="menuitem"')) menu = true
    if (['Td', 'td', 'GridCell'].includes(kind)) name = /styles\.(?:colName|nameCell|searchColName)\b/.test(attrs?.getText(ast) ?? '') || node.getText(ast).includes('<FolderDotName')
    if (['NameCell', 'GridNameCell'].includes(kind) && attrs) {
      name = true
      for (const prop of attrs.properties) if (['sub', 'memo'].includes(prop.name?.getText(ast))) report(prop, 'B-194 名前の2行目')
    }
    if (row && !menu && ['Button', 'button', 'Link', 'RowQuickAction'].includes(kind)) {
      const label = ts.isJsxElement(node) ? node.children.filter(ts.isJsxText).map((child) => child.text.trim()).join('') : attrs?.properties.find((prop) => prop.name?.getText(ast) === 'label')?.initializer?.text
      if (/^(?:編集(?:する|を続ける)?|内容を編集)$/.test(label ?? '')) report(node, 'B-193 行の右の編集')
    }
    if (name && attrs && /styles\.(?:sub|nameSub|cellSub|refCode|slug|rowCode|rowPlan|rowSub|urlText|miniBadgeWarn|miniBadgeDanger)\b/.test(attrs.getText(ast))) report(node, 'B-194 名前の2行目')
    if (name && ['StatusBadge', 'StatusPill', 'StatePill'].includes(kind)) report(node, 'B-194 状態は状態の列')
    if (ts.isCallExpression(node) && /\.tags\.slice$/.test(node.expression.getText(ast))) report(node, 'B-190 タグを切り捨てず+Nへ')
    ts.forEachChild(node, (child) => visit(child, row, menu, name, folderName))
  }
  visit(ast)
  return found
}

export function auditListSources(root) {
  const found = []
  function walk(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const file = resolve(dir, item.name)
      if (item.isDirectory()) walk(file)
      else if (item.name.endsWith('.tsx') && !item.name.includes('.test.')) found.push(...auditListSource(readFileSync(file, 'utf8'), file))
    }
  }
  walk(root)
  return found
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = auditListSources(fileURLToPath(new URL('../src', import.meta.url)))
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1 }
  else console.log('一覧の行の見張り: 合格')
}
