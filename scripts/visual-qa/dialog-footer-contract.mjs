import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 共通の窓に渡す操作を構文で調べる。importの有無だけでは判定しない。 */
export function inspectDialogFooters(source, file = 'screen.tsx') {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const dialogs = new Set(), actions = new Set(), buttons = new Set(['button', 'a'])
  const findings = []
  for (const node of ast.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue
    const path = node.moduleSpecifier.text
    if ((/\/shared\/(?:button|icon-button|page-link)$/.test(path) || path === 'next/link') && node.importClause?.name) buttons.add(node.importClause.name.text)
    if (!path.endsWith('/shared/dialog')) continue
    if (node.importClause?.name) dialogs.add(node.importClause.name.text)
    const named = node.importClause?.namedBindings
    if (named && ts.isNamedImports(named)) for (const item of named.elements) {
      if ((item.propertyName?.text ?? item.name.text) === 'DialogActions') actions.add(item.name.text)
    }
  }
  const tag = node => ts.isJsxElement(node) ? node.openingElement.tagName.getText(ast) : ts.isJsxSelfClosingElement(node) ? node.tagName.getText(ast) : ''
  const attributes = node => ts.isJsxElement(node) ? node.openingElement.attributes.properties : ts.isJsxSelfClosingElement(node) ? node.attributes.properties : []
  const interactive = node => buttons.has(tag(node)) || attributes(node).some(attr => ts.isJsxAttribute(attr) && attr.name.getText(ast) === 'role' && attr.initializer && ts.isStringLiteral(attr.initializer) && attr.initializer.text === 'button')
  const unwrap = node => ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node
  const add = (node, kind) => findings.push({ file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, kind })
  // 同じファイルの薄い包みも、その返す部品が共通の操作帯なら認める。
  const learnWrapper = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isArrowFunction(node.initializer) && actions.has(tag(unwrap(node.initializer.body)))) actions.add(node.name.text)
    ts.forEachChild(node, learnWrapper)
  }
  learnWrapper(ast)
  const resolveLocal = identifier => {
    for (let scope = identifier.parent; scope; scope = scope.parent) {
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue
      for (const statement of scope.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === identifier.text) return declaration.initializer
      }
    }
    return undefined
  }
  const inspect = expression => {
    const resolved = (node, seen = new Set()) => {
      node = unwrap(node)
      if (ts.isIdentifier(node) && node.text !== 'undefined') {
        const local = resolveLocal(node)
        if (local && !seen.has(local)) { seen.add(local); return resolved(local, seen) }
      }
      return node
    }
    expression = resolved(expression)
    const hasJsx = (node, seen = new Set()) => {
      node = resolved(node, seen)
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return true
      return Boolean(ts.forEachChild(node, child => hasJsx(child, seen) || undefined))
    }
    const inspectStructure = node => {
      node = resolved(node)
      if (ts.isConditionalExpression(node)) { inspectStructure(node.whenTrue); inspectStructure(node.whenFalse); return }
      if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) { inspectStructure(node.right); return }
      if (actions.has(tag(node))) {
        const hasButtons = child => interactive(child) || Boolean(ts.forEachChild(child, node => hasButtons(node) || undefined))
        const checkLayout = child => {
          if (tag(child) === 'div' && attributes(child).some(attr => ts.isJsxAttribute(attr) && ['className', 'style'].includes(attr.name.getText(ast))) && hasButtons(child)) add(child, 'nested-custom-dialog-actions')
          ts.forEachChild(child, checkLayout)
        }
        if (ts.isJsxElement(node)) for (const child of node.children) checkLayout(child)
        return
      }
      if (interactive(node)) { add(node, 'custom-dialog-actions'); return }
      if ((ts.isIdentifier(node) && node.text !== 'undefined') || ts.isCallExpression(node)) { add(node, 'unresolved-dialog-footer'); return }
      if (/^[A-Z]/.test(tag(node))) { add(node, 'unresolved-dialog-footer'); return }
      const statusText = tag(node) === 'div' && attributes(node).some(attr =>
        ts.isJsxAttribute(attr) && attr.name.getText(ast) === 'role' &&
        attr.initializer && ts.isStringLiteral(attr.initializer) && attr.initializer.text === 'status')
      if (ts.isJsxElement(node) || ts.isJsxFragment(node)) for (const child of node.children) {
        if (ts.isJsxExpression(child) && child.expression && (!statusText || hasJsx(child.expression))) inspectStructure(child.expression)
        else if (ts.isJsxElement(child) || ts.isJsxFragment(child)) inspectStructure(child)
      }
    }
    inspectStructure(expression)
    const buttonBranches = node => {
      node = resolved(node)
      if (ts.isConditionalExpression(node)) return [...buttonBranches(node.whenTrue), ...buttonBranches(node.whenFalse)]
      if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) return [...buttonBranches(node.left), ...buttonBranches(node.right)]
      if (interactive(node)) {
        const text = ts.isJsxElement(node) ? node.children.map(child => ts.isJsxText(child) ? child.text : ts.isJsxExpression(child) && child.expression && ts.isStringLiteral(child.expression) ? child.expression.text : '').join('').trim() : ''
        return [[text]]
      }
      let result = [[]]
      ts.forEachChild(node, child => { const variants = buttonBranches(child); result = result.flatMap(prefix => variants.map(labels => [...prefix, ...labels])) })
      return result
    }
    if (buttonBranches(expression).some(labels => labels.length === 1 && labels[0] === '閉じる')) add(expression, 'reference-dialog-close-footer')
  }
  const visit = node => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && dialogs.has(node.tagName.getText(ast))) {
      for (const attr of node.attributes.properties) if (ts.isJsxAttribute(attr) && attr.name.getText(ast) === 'footer' && attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression) inspect(attr.initializer.expression)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return findings
}

export function scanDialogFooters(root) {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', 'apps/web/src'], { cwd: root, encoding: 'utf8' }).split('\0')
  return [...new Set(files)].filter(file => file.endsWith('.tsx') && !/\.(?:test|spec)\.tsx$/.test(file) && !file.includes('/visual-qa/')).flatMap(file => {
    const source = readFileSync(resolve(root, file), 'utf8')
    // inspectDialogFooters only checks footer props on direct shared/dialog imports.
    if (!source.includes('/shared/dialog') || !source.includes('footer')) return []
    return inspectDialogFooters(source, file)
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = scanDialogFooters(process.cwd())
  console.log(JSON.stringify(findings, null, 2))
  if (findings.length) process.exitCode = 1
}
