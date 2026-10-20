import ts from 'typescript'
import { analyzeSourceTests } from '../verify-no-source-visual-contracts.mjs'
import { importsOf, moduleResolver, cyclesOf } from './audit.ts'

export const ruleNames = ['screen-fetch', 'screen-staff-me', 'route-500', 'utc-date-slice', 'history-comment', 'history-name', 'history-test-title', 'cycle', 'long-files', 'long-file-lines', 'source-assertion']
const testPath = /(?:^|\/)(?:test|tests|__tests__|fixtures|test-utils)(?:\/|$)|\.(?:test|spec)\./
const codePath = /^(?:apps\/|packages\/|scripts\/).*\.[cm]?[jt]sx?$/
const screenPath = /^apps\/(?:web\/src\/(?:app|v8|components)\/|liff\/src\/(?:(?:components|pages|features|app)\/|[^/]+\.tsx$))/
const routePath = /^apps\/worker\/src\/(?:routes\/|features\/)/
const history = /\b(?:B-\d+|N-\d+|R\d{3,}|U\d{3,})\b|#\d{3,}|20\d\d-\d\d-\d\d|オーナー(?:決定|指摘|判断|承認)|司令塔|マサト|ケンタ|作業役|以前は|前は|だったので|直した|に戻した|指摘|事故|再発防止|回帰試験|消した|外した|\b(?:used to|previously|regression|Codex|Devin|Muse)\b/i
const unwrap = node => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))) node = node.expression
  return node
}
/** @returns {[import('typescript').Expression?, string?]} */
const member = node => {
  node = unwrap(node)
  if (node && ts.isPropertyAccessExpression(node)) return [node.expression, node.name.text]
  if (node && ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return [node.expression, node.argumentExpression.text]
  return []
}
const namedCall = (node, name) => ts.isCallExpression(node) && member(node.expression)[1] === name
const numeric = (node, value) => node && ts.isNumericLiteral(unwrap(node)) && Number(unwrap(node).text) === value
const status500 = node => {
  node = unwrap(node)
  return node && ts.isObjectLiteralExpression(node) && node.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText().replace(/['"]/g, '') === 'status' && numeric(property.initializer, 500))
}
function cssComments(source) {
  const spans = []
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '"' || source[index] === "'") {
      const quote = source[index++]
      while (index < source.length && source[index] !== quote) { if (source[index] === '\\') index++; index++ }
    } else if (source.slice(index, index + 2) === '/*') {
      const end = source.indexOf('*/', index + 2), until = end < 0 ? source.length : end + 2
      spans.push({text: source.slice(index, until), index}); index = until - 1
    }
  }
  return spans
}

export function qualityInventory(files, packages = new Map()) {
  const findings = []
  const add = (rule, file, line, detail, weight = 1) => findings.push({ rule, file, line, detail, weight })
  const sources = new Map([...files].filter(([file]) => codePath.test(file)))
  for (const [file, source] of files) {
    if (!/^(?:apps\/|packages\/|scripts\/)/.test(file)) continue
    if (history.test(file.split('/').at(-1))) add('history-name', file, 1, file)
    const lines = source.split('\n').length - Number(source.endsWith('\n'))
    if (/\.(?:[cm]?[jt]sx?|css|sql|sh|py)$/.test(file) && lines >= 1500) {
      add('long-files', file, 1, `${lines} lines`)
      add('long-file-lines', file, 1, `${lines} lines`, lines)
    }
    if (!codePath.test(file)) {
      if (/\.(?:css|sql|sh|py)$/.test(file)) {
        // SQLの値やシェルの引数を経緯と取り違えないため、コメントだけを検査する。
        const comments = file.endsWith('.css') ? cssComments(source)
          : [...source.matchAll(file.endsWith('.sql') ? /^\s*--.*$/gm : /^\s*#.*$/gm)].map(match => ({text: match[0], index: match.index}))
        for (const comment of comments) comment.text.split('\n').forEach((text, index) => {
          if (history.test(text)) add('history-comment', file, source.slice(0, comment.index).split('\n').length + index, text.trim())
        })
      }
      continue
    }
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    const comments = new Map()
    const visit = node => {
      for (const range of [...ts.getLeadingCommentRanges(source, node.pos) ?? [], ...ts.getTrailingCommentRanges(source, node.end) ?? []]) comments.set(range.pos, range.end)
      const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1
      if (ts.isCallExpression(node)) {
        let call = node.expression
        while (ts.isPropertyAccessExpression(call) || ts.isCallExpression(call)) call = call.expression
        const title = node.arguments[0]
        if (ts.isIdentifier(call) && /^(?:it|test|describe)$/.test(call.text) && title && ts.isStringLiteralLike(title) && history.test(title.text)) add('history-test-title', file, line, title.text)
      }
      if (!testPath.test(file) && (ts.isCallExpression(node) || ts.isNewExpression(node))) {
        const expr = unwrap(node.expression), [receiver, name] = member(expr)
        const args = node.arguments ?? []
        if (screenPath.test(file)) {
          if (ts.isIdentifier(expr) && expr.text === 'fetch' || name === 'fetch' && receiver && /^(?:globalThis|window|self)$/.test(receiver.getText(ast))) add('screen-fetch', file, line, node.getText(ast))
          const [api, staff] = member(receiver)
          if (name === 'me' && staff === 'staff' && api?.getText(ast) === 'api') add('screen-staff-me', file, line, node.getText(ast))
        }
        if (routePath.test(file) && (
          ['json', 'text', 'body', 'newResponse', 'status'].includes(name) && (numeric(args[1], 500) || status500(args[1]) || name === 'status' && numeric(args[0], 500))
          || ts.isNewExpression(node) && ts.isIdentifier(expr) && expr.text === 'Response' && status500(args[1])
        )) add('route-500', file, line, node.getText(ast))
        if ((name === 'slice' || name === 'substring') && numeric(args[0], 0) && numeric(args[1], 10) && receiver && namedCall(unwrap(receiver), 'toISOString')) add('utc-date-slice', file, line, node.getText(ast))
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
    for (const [start, end] of comments) source.slice(start, end).split('\n').forEach((text, offset) => {
      if (history.test(text)) add('history-comment', file, ast.getLineAndCharacterOfPosition(start).line + offset + 1, text.trim())
    })
  }
  const resolveModule = moduleResolver(sources, packages)
  const graph = new Map([...sources].filter(([file]) => !testPath.test(file) && !file.endsWith('.d.ts')).map(([file, source]) => [file, importsOf(file, source).flatMap(edge => {
    const target = resolveModule(file, edge.specifier)
    return target ? [{...edge, target}] : []
  })]))
  for (const cycle of cyclesOf(graph, true, true)) add('cycle', cycle[0], 1, cycle.join(' → '))
  for (const hit of analyzeSourceTests(sources)) findings.push({rule: 'source-assertion', file: hit.file, line: hit.line, detail: hit.expression, weight: 1, entry: hit.entry, reason: hit.reason})
  const counts = Object.fromEntries(ruleNames.map(rule => [rule, findings.filter(hit => hit.rule === rule).reduce((sum, hit) => sum + hit.weight, 0)]))
  return { counts, findings }
}

/** 実測と一致し、信頼するbaseから減った値だけを記録する。 */
export function compareInventory(current, baseline, previous) {
  const errors = []
  for (const counts of [baseline, previous].filter(Boolean)) {
    if (Object.keys(counts).sort().join() !== [...ruleNames].sort().join() || Object.values(counts).some(n => !Number.isSafeInteger(n) || n < 0)) errors.push('baseline schema mismatch')
  }
  for (const rule of ruleNames) {
    if (current[rule] !== baseline[rule]) errors.push(`${rule}: measured ${current[rule]}, baseline ${baseline[rule]} (reduce the snapshot when violations decrease)`)
    if (previous && baseline[rule] > previous[rule]) errors.push(`${rule}: baseline increased ${previous[rule]} → ${baseline[rule]}`)
  }
  return errors
}
