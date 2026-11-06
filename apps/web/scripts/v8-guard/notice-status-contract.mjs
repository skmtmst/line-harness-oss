import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ts = require('typescript')

/** 表示されるNoticeの中へ素のbuttonを戻す変更を、全ソースで見つける。 */
export function nativeNoticeButtons(source, file = 'screen.tsx') {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = new Set(['Notice', 'ReadOnlyNotice'])
  const createElements = new Set(['createElement'])
  const scopes = new Map()
  const found = new Set()
  const isScope = node => ts.isSourceFile(node) || ts.isBlock(node) || ts.isFunctionLike(node)
  const enclosingScope = node => { while (node && !isScope(node)) node = node.parent; return node }
  const bind = (node, name, value) => {
    const scope = enclosingScope(node)
    if (!scopes.has(scope)) scopes.set(scope, new Map())
    scopes.get(scope).set(name, value)
  }
  const declarations = node => {
    if (ts.isImportDeclaration(node)) {
      if (node.importClause?.name && /(?:^|\/)(?:notice|read-only-notice)$/.test(node.moduleSpecifier.text)) names.add(node.importClause.name.text)
      const bindings = node.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
        const original = (item.propertyName ?? item.name).text
        if (['Notice', 'ReadOnlyNotice'].includes(original)) names.add(item.name.text)
        if (node.moduleSpecifier.text === 'react' && original === 'createElement') createElements.add(item.name.text)
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) bind(node.parent, node.name.text, node.initializer)
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) bind(node.parent, node.name.text, undefined)
    if (ts.isFunctionDeclaration(node) && node.name && node.body) bind(node.parent, node.name.text, node.body)
    ts.forEachChild(node, declarations)
  }
  declarations(tree)
  const resolve = node => {
    for (let scope = node.parent; scope; scope = scope.parent) {
      if (scopes.get(scope)?.has(node.text)) return scopes.get(scope).get(node.text)
    }
    return undefined
  }
  const createsElement = node => ts.isCallExpression(node) && (createElements.has(node.expression.getText(tree)) || ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'createElement')
  const inspect = (node, seen = new Set()) => {
    if (ts.isJsxAttribute(node) && /^on[A-Z]/.test(node.name.getText(tree))) return
    if (ts.isPropertyAccessExpression(node)) { inspect(node.expression, seen); return }
    if (ts.isIdentifier(node) && !(ts.isJsxAttribute(node.parent) && node.parent.name === node)) {
      const value = resolve(node)
      if (value && !seen.has(value)) { const next = new Set(seen); next.add(value); inspect(value, next) }
    }
    if ((ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'button') || (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'button')) found.add(tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1)
    if (createsElement(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'button') found.add(tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1)
    ts.forEachChild(node, child => inspect(child, seen))
  }
  const visit = node => {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null
    if (opening && names.has(opening.tagName.getText(tree))) inspect(node)
    if (createsElement(node) && node.arguments[0] && names.has(node.arguments[0].getText(tree))) inspect(node)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return [...found].sort((a, b) => a - b)
}

export function collectNativeNoticeButtons(root) {
  const result = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory() && !entry.name.startsWith('.') && !['node_modules', 'generated'].includes(entry.name)) walk(file)
      else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
        for (const line of nativeNoticeButtons(fs.readFileSync(file, 'utf8'), file)) result.push({ file: path.relative(root, file), line })
      }
    }
  }
  walk(root)
  return result
}
