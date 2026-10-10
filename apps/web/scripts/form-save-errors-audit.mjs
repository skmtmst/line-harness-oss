import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const mutationMethod = /^(?:(?:create|update|save|register|upsert|replace|publish|connect|set|patch|edit)(?:$|[A-Z_])|(?:bulk|batch)(?:Create|Update|Save))/
function hasMutation(node) {
  let found = false
  visit(node, (child) => {
    if (!ts.isCallExpression(child)) return
    const expression = child.expression
    if (ts.isPropertyAccessExpression(expression) && /^(?:api|[A-Za-z]\w*Api)\./.test(expression.getText()) && mutationMethod.test(expression.name.text) && !/(?:Validation|Preview|Impact)$/.test(expression.name.text)) found = true
    if (/^(?:saveTemplateEdit|save\w*Draft|onSave|host\.save|host\.onSave)$/.test(expression.getText())) found = true
  })
  return found
}
function visit(node, fn) { fn(node); ts.forEachChild(node, (child) => visit(child, fn)) }
function isFunction(node) { return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) }
function functionName(node) { return node.name?.getText() ?? (ts.isVariableDeclaration(node.parent) ? node.parent.name.getText() : '') }
function componentOf(node) {
  for (let parent = node.parent; parent; parent = parent.parent) if (isFunction(parent) && /^(?:[A-Z]|use[A-Z])/.test(functionName(parent))) return parent
  return null
}
function hasScope(component, root) {
  return /<SaveErrorScope\b|fields=\{|return\s*\{\s*saveErrors\b/.test(component.getText(root))
}

/** 保存するcatch自身を見る。importだけ・別のcatchで受けるだけでは合格しない。 */
export function auditFormSaveErrors(source, filename = 'screen.tsx') {
  const root = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const findings = []
  visit(root, (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'catch'
      && hasMutation(node.expression.expression)) {
      const component = componentOf(node)
      const callback = node.arguments[0]
      if (component && callback) {
        const wired = /\.capture\s*\(|\.setServerErrors\s*\(/.test(callback.getText(root))
        if (!wired || !hasScope(component, root)) findings.push({ filename, component: functionName(component), line: root.getLineAndCharacterOfPosition(node.getStart(root)).line + 1, reason: !wired ? '保存Promiseのcatchが欄の理由を受けていません' : '欄へ渡すスコープがありません' })
      }
    }
    if (!ts.isTryStatement(node) || !node.catchClause) return
    let saves = hasMutation(node.tryBlock)
    for (let parent = node.parent; !saves && parent; parent = parent.parent) {
      if (isFunction(parent)) { saves = /save|submit|persist|publish/i.test(functionName(parent)) && /await/.test(node.tryBlock.getText(root)); break }
    }
    if (!saves) return
    const component = componentOf(node)
    if (!component) return // 非画面のAPIヘルパーは呼び出し側へエラーを渡す。
    const catchText = node.catchClause.getText(root)
    const wired = /\.capture\s*\(|\.setServerErrors\s*\(/.test(catchText)
    const scope = hasScope(component, root)
    if (!wired || !scope) findings.push({ filename, component: functionName(component), line: root.getLineAndCharacterOfPosition(node.catchClause.getStart(root)).line + 1, reason: !wired ? '欄の理由を受けず、上の知らせだけにしています' : '欄へ渡すスコープがありません' })
  })
  return findings
}

export function savedScreenFiles(root) {
  return ['src/v8', 'src/app'].flatMap((dir) => fs.readdirSync(path.join(root, dir), { recursive: true }).map((file) => path.join(dir, file)))
    .filter((file) => file.endsWith('.tsx') && !/\.(?:test|spec)\.tsx$|fixture/.test(file) && (file.startsWith('src/v8/') || file.endsWith('-v8.tsx') || file.includes('/v8/')))
    .sort()
}

export function auditSavedScreens(root) {
  return savedScreenFiles(root).flatMap((file) => auditFormSaveErrors(fs.readFileSync(path.join(root, file), 'utf8'), file))
}
