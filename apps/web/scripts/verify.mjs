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
          let owner = node.parent
          while (owner && !ts.isFunctionLike(owner)) owner = owner.parent
          const scope = owner?.name?.getText(ast)
          if (match && !/\brequired\s*:/.test(definitions.get(`${scope}:${match[1]}:${match[2]}`) ?? definitions.get(`${match[1]}:${match[2]}`) ?? '')) add(node, 'requirement-without-definition')
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

/** Trace an explicitly passed field object into a local render helper.
 * Every call must pass the same defined fields; a definition in an unrelated
 * function, another object, or only one of several callers cannot approve it.
 */
function passedFieldDefinitions(root, files) {
  const modules = new Map(files.map(file => [file, ts.createSourceFile(file, readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)]))
  const incoming = new Map()
  for (const [caller, ast] of modules) {
    const imports = new Map()
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.startsWith('.')) continue
      const bindings = statement.importClause?.namedBindings
      if (!bindings || !ts.isNamedImports(bindings)) continue
      const stem = path.resolve(root, path.dirname(caller), statement.moduleSpecifier.text)
      const target = [stem, `${stem}.tsx`, `${stem}.ts`].map(file => path.relative(root, file)).find(file => modules.has(file))
      if (!target) continue
      const module = modules.get(target)
      for (const binding of bindings.elements) {
        const name = (binding.propertyName ?? binding.name).text
        const fn = module.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))
        if (fn?.parameters[0] && ts.isObjectBindingPattern(fn.parameters[0].name)) imports.set(binding.name.text, { target, fn })
      }
    }
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && imports.has(node.expression.text)) {
        const { target, fn } = imports.get(node.expression.text)
        const argument = node.arguments[0]
        for (const binding of fn.parameters[0].name.elements) {
          if (!ts.isIdentifier(binding.name)) continue
          const key = (binding.propertyName ?? binding.name).text
          const property = argument && ts.isObjectLiteralExpression(argument) && argument.properties.find(item => item.name && ts.isIdentifier(item.name) && item.name.text === key)
          const actual = property && (ts.isShorthandPropertyAssignment(property) ? property.name : ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer) ? property.initializer : null)
          const definitions = new Map()
          if (actual) {
            for (let scope = node.parent; scope; scope = scope.parent) {
              if (!ts.isFunctionLike(scope) || !scope.body || !ts.isBlock(scope.body)) continue
              function collect(child) {
                if (ts.isFunctionLike(child)) return
                if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression) && child.expression.name.text === 'define' && ts.isIdentifier(child.expression.expression) && child.expression.expression.text === actual.text && ts.isStringLiteral(child.arguments[0]) && child.pos < node.pos) {
                  const field = child.arguments[0].text
                  if (!definitions.has(field)) definitions.set(field, child.arguments[3]?.getText(ast) ?? '')
                }
                ts.forEachChild(child, collect)
              }
              collect(scope.body)
              // The closest lexical declaration owns this object.
              const declares = scope.parameters.some(parameter => ts.isIdentifier(parameter.name) && parameter.name.text === actual.text)
                || scope.body.statements.some(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === actual.text))
              if (declares) break
            }
          }
          const id = `${target}:${fn.name.text}:${binding.name.text}`
          const calls = incoming.get(id) ?? { target, fn: fn.name.text, object: binding.name.text, definitions: [] }
          calls.definitions.push(definitions)
          incoming.set(id, calls)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  const result = new Map()
  for (const { target, fn, object, definitions } of incoming.values()) {
    const shared = result.get(target) ?? new Map()
    for (const [field, check] of definitions[0]) if (definitions.every(call => call.get(field) === check)) shared.set(`${fn}:${object}:${field}`, check)
    result.set(target, shared)
  }
  return result
}

export function inspectB244Tree(root) {
  const files = []
  function walk(directory) {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (/\.tsx$/.test(file) && !/\.(test|spec)\.|fixture|visual-qa/.test(file)) files.push(file)
    }
  }
  walk('src/v8'); walk('src/app')
  // 改名や配置の変更で見張りから漏らさない。app と v8 の全実装を同じ条件で検査する。
  const active = files
  const passed = passedFieldDefinitions(root, active)
  return { files: active.length, errors: active.flatMap(f => {
    const source = readFileSync(path.join(root, f), 'utf8')
    return inspectB244Source(source, f, new Map([...(passed.get(f) ?? []), ...hookDefinitions(root, f, source)]))
  }) }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectB244Tree(fileURLToPath(new URL('../', import.meta.url)))
  for (const item of result.errors) console.error(`${item.filename}:${item.line} ${item.kind}`)
  console.log(`B-244/245 ソース：${result.files}ファイル・違反${result.errors.length}`)
  if (result.errors.length) process.exitCode = 1
}
