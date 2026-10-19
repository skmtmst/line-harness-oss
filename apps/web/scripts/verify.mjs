/** ：必須/任意と保存時検証の定義が矛盾しないことを確認する。 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export function inspectB244Source(source, filename = 'screen.tsx', importedDefinitions = new Map()) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const errors = []
  const add = (node, kind) => errors.push({ filename, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, kind })
  const attributes = node => Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(a => [a.name.getText(ast), a.initializer?.getText(ast) ?? 'true']))
  const definitions = new Map(importedDefinitions)
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

    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return errors
}

/** Follow the particular field object returned by a locally imported hook.
 * A same-named definition elsewhere, or a hook that doesn't return it, is not evidence.
 */
function hookDefinitions(root, filename, source) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hooks = new Map(), definitions = new Map()
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith('.')) continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    const stem = path.resolve(root, path.dirname(filename), statement.moduleSpecifier.text)
    if (path.relative(root, stem).startsWith('..')) continue
    const moduleFile = [stem, `${stem}.ts`, `${stem}.tsx`].find(file => existsSync(file) && /\.tsx?$/.test(file))
    if (!moduleFile) continue
    const module = ts.createSourceFile(moduleFile, readFileSync(moduleFile, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    for (const binding of bindings.elements) {
      const name = (binding.propertyName ?? binding.name).text
      const fn = module.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))
      if (fn?.body) hooks.set(binding.name.text, { module, fn })
    }
  }
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression)) {
      const hook = hooks.get(node.initializer.expression.text)
      if (hook) {
        const returned = new Map(), checks = new Map()
        for (const statement of hook.fn.body.statements) {
          if (!ts.isReturnStatement(statement) || !statement.expression || !ts.isObjectLiteralExpression(statement.expression)) continue
          for (const property of statement.expression.properties) {
            if (ts.isShorthandPropertyAssignment(property)) returned.set(property.name.text, property.name.text)
            else if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && ts.isIdentifier(property.initializer)) returned.set(property.name.text, property.initializer.text)
          }
        }
        function collect(child) {
          if (ts.isFunctionLike(child)) return
          if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression) && child.expression.name.text === 'define' && ts.isStringLiteral(child.arguments[0])) {
            checks.set(`${child.expression.expression.getText(hook.module)}:${child.arguments[0].text}`, child.arguments[3]?.getText(hook.module) ?? '')
          }
          ts.forEachChild(child, collect)
        }
        collect(hook.fn.body)
        for (const binding of node.name.elements) {
          if (!ts.isIdentifier(binding.name) || binding.dotDotDotToken) continue
          const exported = (binding.propertyName ?? binding.name).getText(ast)
          const object = returned.get(exported)
          if (!object) continue
          for (const [key, check] of checks) if (key.startsWith(`${object}:`)) definitions.set(`${binding.name.text}:${key.slice(object.length + 1)}`, check)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return definitions
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
  return { files: active.length, errors: active.flatMap(f => {
    const source = readFileSync(path.join(root, f), 'utf8')
    return inspectB244Source(source, f, hookDefinitions(root, f, source))
  }) }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectB244Tree(fileURLToPath(new URL('../', import.meta.url)))
  for (const item of result.errors) console.error(`${item.filename}:${item.line} ${item.kind}`)
  console.log(`B-244/245 ソース：${result.files}ファイル・違反${result.errors.length}`)
  if (result.errors.length) process.exitCode = 1
}
