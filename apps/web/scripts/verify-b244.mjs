/** B-244/245：共通部品へ戻る前のソース検査。描画の位置・色はブラウザ検査で確認する。 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export function inspectB244Source(source, filename = 'screen.tsx') {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const errors = []
  const add = (node, kind) => errors.push({ filename, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, kind })
  const attributes = node => Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(a => [a.name.getText(ast), a.initializer?.getText(ast) ?? 'true']))
  const definitions = new Map()
  function collect(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'define' && ts.isStringLiteral(node.arguments[0])) {
      definitions.set(`${node.expression.expression.getText(ast)}:${node.arguments[0].text}`, node.arguments[3]?.getText(ast) ?? '')
    }
    ts.forEachChild(node, collect)
  }
  collect(ast)
  function visit(node) {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null
    if (opening) {
      const tag = opening.tagName.getText(ast), attrs = attributes(opening)
      if (/^(Field|SharedField|FormField)$/.test(tag)) {
        if (['true', '{true}'].includes(attrs.required) && ['true', '{true}'].includes(attrs.optional)) add(node, 'requirement-conflict')
        if (attrs.requirement) {
          const match = attrs.requirement.match(/([\w.]+)\.requirement\(['"]([^'"]+)['"]\)/)
          if (match && !/\brequired\s*:/.test(definitions.get(`${match[1]}:${match[2]}`) ?? '')) add(node, 'requirement-without-definition')
        }
      }
      if (tag === 'Notice' && attrs.tone === '"info"' && /<ListPage\b/.test(source)) {
        let conditional = false, inWindow = false
        for (let parent = node.parent; parent && !ts.isFunctionLike(parent); parent = parent.parent) {
          if (ts.isConditionalExpression(parent) || ts.isIfStatement(parent) || ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) conditional = true
          if (ts.isJsxElement(parent) && /Dialog|Drawer|DetailPanel/.test(parent.openingElement.tagName.getText(ast))) inWindow = true
        }
        const content = attrs.message ?? (ts.isJsxElement(node) ? node.children.map(c => c.getText(ast)).join('') : '')
        const literal = !/[{}]/.test(content)
        if (!conditional && !inWindow && literal) add(node, 'permanent-list-notice')
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return errors
}

export function inspectB244Tree(root) {
  const files = []
  function walk(directory) {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (/\.tsx$/.test(file) && !/\.(test|spec)\.|fixture|visual-qa/.test(file) && (file.startsWith('src/v8/') || /v8\.tsx$/.test(file))) files.push(file)
    }
  }
  walk('src/v8'); walk('src/app')
  // コピー元として残る旧いV8は検査せず、現在のV8へのimportがある物を対象にする。
  const active = files.filter(f => f.startsWith('src/v8/') || !files.some(other => other.startsWith('src/v8/') && path.basename(other) === path.basename(f)))
  return { files: active.length, errors: active.flatMap(f => inspectB244Source(readFileSync(path.join(root, f), 'utf8'), f)) }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectB244Tree(fileURLToPath(new URL('../', import.meta.url)))
  for (const item of result.errors) console.error(`${item.filename}:${item.line} ${item.kind}`)
  console.log(`B-244/245 ソース：${result.files}ファイル・違反${result.errors.length}`)
  if (result.errors.length) process.exitCode = 1
}
