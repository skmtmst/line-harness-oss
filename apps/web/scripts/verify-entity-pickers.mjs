/** B-155/163/164/165/175: growing entity lists must use the shared dialog. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const dropdownModules = /(?:^|\/)(?:select|combobox|multi-select)$/
const entityWords = /(?:tag|staff|account|scenario|template|friendField|customField|supportMark|form|menu|table|store|segment|coupon|reminder|webhook|actionVersion|savedAnalysis|savedOptions|friendOptions|recipient|inflow|trackedLink|resource)(?:s|Options|Candidates|List|Items)?\b/i
const folderLabel = /フォルダ|置き場/

export function inspectPickers(text, file = 'component.tsx') {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const dropdowns = new Set(['select'])
  const definitions = new Map()
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && dropdownModules.test(statement.moduleSpecifier.text)) {
      if (statement.importClause?.name) dropdowns.add(statement.importClause.name.text)
      const named = statement.importClause?.namedBindings
      if (named && ts.isNamedImports(named)) for (const name of named.elements) dropdowns.add(name.name.text)
    }
  }
  function collect(node) {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) definitions.set(node.name.text, node.body.getText(source))
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) definitions.set(node.name.text, node.initializer.getText(source))
    ts.forEachChild(node, collect)
  }
  collect(source)
  function expandOptions(value, depth = 0, seen = new Set()) {
    if (depth >= 3) return value
    const tree = ts.createSourceFile('options.tsx', value, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const edits = []
    function expand(node) {
      if (ts.isIdentifier(node) && /options|choices|candidates/i.test(node.text) && definitions.has(node.text) && !seen.has(node.text)) {
        const parent = node.parent
        const isName = (ts.isPropertyAssignment(parent) || ts.isPropertyAccessExpression(parent) || ts.isVariableDeclaration(parent) || ts.isParameter(parent)) && parent.name === node
        if (!isName) edits.push({ start: node.getStart(tree), end: node.end, text: expandOptions(definitions.get(node.text), depth + 1, new Set([...seen, node.text])) })
      }
      ts.forEachChild(node, expand)
    }
    expand(tree)
    for (const edit of edits.sort((a, b) => b.start - a.start)) value = value.slice(0, edit.start) + edit.text + value.slice(edit.end)
    return value
  }
  // V8 already replaces these explicitly hidden V7 branches. No filename exemption.
  function legacyOnly(node) {
    for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
      const element = ts.isJsxElement(parent) ? parent.openingElement : ts.isJsxSelfClosingElement(parent) ? parent : undefined
      if (element?.attributes.properties.some((attr) => ts.isJsxAttribute(attr) && attr.name.getText(source) === 'className' && /\bv7-only\b/.test(attr.initializer?.getText(source) ?? ''))) return true
      if (ts.isConditionalExpression(parent) && child === parent.whenFalse && /\bisV8\b/.test(parent.condition.getText(source)) && /<EntitySelect\b/.test(parent.whenTrue.getText(source))) return true
    }
    return false
  }
  const violations = []
  function visit(node) {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && dropdowns.has(node.tagName.getText(source)) && !legacyOnly(node)) {
      const attrs = new Map(node.attributes.properties.filter(ts.isJsxAttribute).map((attr) => [attr.name.getText(source), attr.initializer?.getText(source) ?? '']))
      const label = attrs.get('aria-label') ?? attrs.get('label') ?? ''
      let options = attrs.get('options') ?? (node.tagName.getText(source) === 'select' && ts.isJsxElement(node.parent) ? node.parent.children.map((child) => child.getText(source)).join('') : '')
      const identifier = options.match(/^\{([A-Za-z_$][\w$]*)\}$/)?.[1]
      if (identifier && definitions.has(identifier)) options = definitions.get(identifier)
      options = expandOptions(options)

      // Folder rails collapse to a Select by B-164. Identity comparisons choose between two existing values.
      const comparison = /sourceFriendId/.test(options) && /identity-decision-dialog|friends\/compare/.test(file)
      const folderRail = /templates\/list-page\.tsx$/.test(file) && /rows\.map/.test(options)
      const folderPicker = /shared\/entity-picker\.tsx$/.test(file) && /folderRows/.test(options)
      const dynamicEntity = /value\s*(?::|=\{)[^,}\n]*\b\w+\.(?:id|\w+Id)\b/.test(options) || Boolean(identifier && entityWords.test(identifier))
      if (!folderLabel.test(label) && !comparison && !folderRail && !folderPicker && dynamicEntity) {
        violations.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, label, message: '作った物の選択は EntityPickerField / EntitySelect を使ってください。' })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return violations
}

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(path.join(directory, entry.name)) : /\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) ? [path.join(directory, entry.name)] : [])
}
function resolve(from, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('@/')) return undefined
  const base = spec.startsWith('@/') ? path.join(sourceRoot, spec.slice(2)) : path.resolve(path.dirname(from), spec)
  return [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
}
export function checkProject() {
  const seen = new Set(), issues = []
  function visit(file) {
    if (!file || seen.has(file)) return
    seen.add(file)
    const text = fs.readFileSync(file, 'utf8')
    const imports = [...text.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)]
    // Older entry files return the V8 component before their former implementation.
    const early = text.match(/if\s*\(theme\s*===\s*['"]v8['"]\)\s*(?:\{\s*)?return\s*(?:\(\s*)?<([A-Z]\w*)/) ?? text.match(/return\s+theme\s*===\s*['"]v8['"]\s*\?\s*<([A-Z]\w*)/)
    if (early) {
      const entry = imports.find((item) => new RegExp(`\\b${early[1]}\\b`).test(item[1]))
      if (entry) { visit(resolve(file, entry[2])); return }
    }
    issues.push(...inspectPickers(text, path.relative(sourceRoot, file)))
    for (const item of imports) visit(resolve(file, item[2]))
    for (const item of text.matchAll(/(?:import\(\s*|export\s+[^;]*?from\s+)['"]([^'"]+)['"]/g)) visit(resolve(file, item[1]))
  }
  for (const file of files(path.join(sourceRoot, 'app')).filter((file) => /\/(?:page|layout)\.tsx$/.test(file))) visit(file)
  return issues
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const issues = checkProject()
  for (const issue of issues) console.error(`${issue.file}:${issue.line} ${issue.label}: ${issue.message}`)
  if (issues.length) process.exitCode = 1
  else console.log('Entity picker guard: passed')
}
