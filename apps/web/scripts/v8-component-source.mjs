import ts from 'typescript'

/** 公開されたV8部品は、ファイルを用途名へ変えても同じ画面として扱う。 */
export function hasExportedV8Component(ast) {
  return ast.statements.some(node => ts.isFunctionDeclaration(node)
    && node.name?.text.endsWith('V8')
    && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))
}

/** V8へ直通する入口も、入口自身に足された見た目を検査する。 */
export function isV8Adapter(ast) {
  const isV8Path = value => /(?:^|\/)v8\//.test(value)
  for (const node of ast.statements) {
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier) && isV8Path(node.moduleSpecifier.text)
      && node.exportClause && ts.isNamedExports(node.exportClause)
      && node.exportClause.elements.some(binding => binding.name.text === 'default' && !binding.isTypeOnly)) return true
  }
  let rendersV8 = false
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(ast)
      if (/V8$/.test(name)) {
        // 直通の入口を拾い、テーマ分岐を持つ旧画面の中身まで新たに広げない。
        let conditional = false
        let returned = false
        for (let parent = node.parent; parent; parent = parent.parent) {
          if (ts.isIfStatement(parent) || ts.isConditionalExpression(parent)) conditional = true
          if (ts.isReturnStatement(parent)) returned = true
          if (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isArrowFunction(parent)) {
            if (ts.isArrowFunction(parent) && !ts.isBlock(parent.body)) returned = true
            break
          }
        }
        if (returned && !conditional) rendersV8 = true
      }
    }
    if (!rendersV8) ts.forEachChild(node, visit)
  }
  visit(ast)
  return rendersV8
}
