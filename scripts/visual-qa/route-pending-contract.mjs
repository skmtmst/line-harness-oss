import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

/** 入口が待っている間に、明示的な空表示へ戻らないことを構文で守る。 */
export function inspectRoutePending(source, file = 'page.tsx') {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = new Set(), namespaces = new Set(), bindings = new Map(), findings = []
  for (const node of ast.statements) {
    if (!ts.isImportDeclaration(node) || node.moduleSpecifier.text !== 'react') continue
    const clause = node.importClause
    if (clause?.name) namespaces.add(clause.name.text)
    const imports = clause?.namedBindings
    if (imports && ts.isNamespaceImport(imports)) namespaces.add(imports.name.text)
    if (imports && ts.isNamedImports(imports)) for (const entry of imports.elements) if ((entry.propertyName ?? entry.name).text === 'Suspense') names.add(entry.name.text)
  }
  const collect = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) bindings.set(node.name.text, node.initializer)
    ts.forEachChild(node, collect)
  }
  collect(ast)
  const empty = (node, seen = new Set()) => {
    if (!node) return true
    if (ts.isJsxExpression(node) || ts.isParenthesizedExpression(node)) return empty(node.expression, seen)
    if ([ts.SyntaxKind.NullKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.TrueKeyword].includes(node.kind)) return true
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) return !node.text.trim()
    if (ts.isJsxFragment(node)) return node.children.every(child => empty(child, seen))
    if (ts.isConditionalExpression(node)) return empty(node.whenTrue, seen) || empty(node.whenFalse, seen)
    if (ts.isIdentifier(node)) {
      if (node.text === 'undefined') return true
      if (seen.has(node.text) || !bindings.has(node.text)) return false
      return empty(bindings.get(node.text), new Set([...seen, node.text]))
    }
    return false
  }
  const visit = node => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(ast), parts = tag.split('.')
      if (names.has(tag) || (parts.length === 2 && namespaces.has(parts[0]) && parts[1] === 'Suspense')) {
        const fallback = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === 'fallback')
        if (!fallback || empty(fallback.initializer)) findings.push({ file, line: ast.getLineAndCharacterOfPosition(node.getStart()).line + 1, kind: 'empty-route-pending' })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return findings
}

export function scanRoutePending(root) {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', 'apps/web/src/app'], { cwd: root, encoding: 'utf8' }).split('\0')
  return [...new Set(files)].filter(file => file.endsWith('.tsx') && !/\.(?:test|spec)\.tsx$/.test(file)).flatMap(file => inspectRoutePending(readFileSync(join(root, file), 'utf8'), file))
}
