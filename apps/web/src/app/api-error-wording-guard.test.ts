import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

import { describe, expect, it } from 'vitest'

/**
 * 「API error: 500」を画面に出さない見張り（リリース前点検 2026-10-07）。
 *
 * `ApiError` の message は、403・5xx などでは `API error: 500` という内部の文になる
 * （`lib/api.ts`）。`caught instanceof Error ? caught.message : '…'` のように message を
 * そのまま画面へ出すと、運用者に英語と番号だけが見える。画面に出すときは
 * `japaneseDetailOf(err) || '…'`（`components/shared/api-error-message`）か
 * `describeSaveFailure(err)`（`lib/api`）に寄せる。
 *
 * 持ち越しは BASELINE に「ファイル → 箇所の数」で残し、増えたら落とす（新しく混ぜない）。
 * 直したら数を減らすか行を消す——残っている限り、ここが「まだ直っていない画面」の一覧になる。
 * `API error` を同じ行で弾いている形（`!/^API error: /.test(...)`）は数えない。
 */

const SRC = path.join(__dirname, '..')

function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, match => match.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
    .replace(/^[^\S\n]*\/\/.*$/gm, match => ' '.repeat(match.length))
}

/** message をそのまま画面の文にしている形。 */
export const RAW_MESSAGE = /instanceof (?:Api)?Error(?: \|\| \w+ instanceof (?:Api)?Error)?(?: && \w+\.message)? \? \w+\.message\b|&& \w+\.message\) return \w+\.message/

const SAFE_MESSAGE_CALL = /^(?:extractApiErrorMessage|describeApiFailure|describeSaveFailure|japaneseDetailOf)$/

function directMessage(node: ts.Node): boolean {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) return directMessage(node.expression)
  if (ts.isPropertyAccessExpression(node)) {
    if (node.name.text === 'message' && ts.isCallExpression(node.expression) && /^(?:describeFriendAddFailure|describeFolderFailure)$/.test(node.expression.expression.getText())) return false
    return node.name.text === 'message' || directMessage(node.expression)
  }
  if (ts.isBinaryExpression(node)) return directMessage(node.left) || directMessage(node.right)
  if (ts.isConditionalExpression(node)) return directMessage(node.whenTrue) || directMessage(node.whenFalse)
  if (ts.isCallExpression(node)) return node.expression.getText() !== 'extractApiErrorCode' && !SAFE_MESSAGE_CALL.test(node.expression.getText()) && (directMessage(node.expression) || node.arguments.some(directMessage))
  if (ts.isTemplateExpression(node)) return node.templateSpans.some(span => directMessage(span.expression))
  if (ts.isObjectLiteralExpression(node)) return node.properties.some(property => ts.isPropertyAssignment(property) && directMessage(property.initializer))
  return false
}

export function countRawMessageLines(source: string): number {
  const parsed = ts.createSourceFile('screen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const lines = new Set<number>()
  const mark = (node: ts.Node) => lines.add(parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line)
  const errorCheck = (condition: ts.Expression) => /\binstanceof\s+\w*Error\b|\bisApiError\s*\(/.test(condition.getText(parsed))
  const sanitized = (node: ts.Node) => {
    let parent = node.parent
    while (parent && !ts.isFunctionLike(parent)) {
      if (ts.isCallExpression(parent) && SAFE_MESSAGE_CALL.test(parent.expression.getText(parsed))) return true
      parent = parent.parent
    }
    return false
  }
  const errorValue = (node: ts.Node): boolean => {
    const roots = new Set(['caught', 'error', 'err', 'e', 'reason', 'cause', 'submitError', 'saveError', 'deleteError'])
    let boundary: ts.Node | undefined = node
    while (boundary && !ts.isFunctionLike(boundary)) boundary = boundary.parent
    if (boundary && (ts.isArrowFunction(boundary) || ts.isFunctionExpression(boundary))) {
      const call = boundary.parent
      if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'catch') {
        for (const parameter of boundary.parameters) if (ts.isIdentifier(parameter.name)) roots.add(parameter.name.text)
      }
    }
    let parent: ts.Node | undefined = node
    while (parent && !ts.isFunctionLike(parent)) {
      if (ts.isCatchClause(parent) && parent.variableDeclaration && ts.isIdentifier(parent.variableDeclaration.name)) {
        roots.add(parent.variableDeclaration.name.text)
        let changed = true
        while (changed) {
          changed = false
          const aliases = (child: ts.Node) => {
            if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && child.initializer) {
              let value = child.initializer
              while (ts.isAsExpression(value) || ts.isParenthesizedExpression(value) || ts.isNonNullExpression(value)) value = value.expression
              if (ts.isIdentifier(value) && roots.has(value.text) && !roots.has(child.name.text)) { roots.add(child.name.text); changed = true }
            }
            ts.forEachChild(child, aliases)
          }
          aliases(parent.block)
        }
      }
      parent = parent.parent
    }
    let found = false
    const inspect = (child: ts.Node) => {
      if (ts.isPropertyAccessExpression(child) && child.name.text === 'message') {
        let receiver = child.expression
        while (ts.isAsExpression(receiver) || ts.isParenthesizedExpression(receiver) || ts.isNonNullExpression(receiver)) receiver = receiver.expression
        if (ts.isIdentifier(receiver) && roots.has(receiver.text)) found = true
      }
      ts.forEachChild(child, inspect)
    }
    inspect(node)
    return found
  }
  function visit(node: ts.Node) {
    if (ts.isConditionalExpression(node) && errorCheck(node.condition) && !sanitized(node)
      && (directMessage(node.whenTrue) || directMessage(node.whenFalse))) mark(node)
    if (ts.isCallExpression(node) && /^(?:set\w*(?:Error|Errors|Message|Notice|Status|State)|notifyToast|toast\.(?:error|warning))$/.test(node.expression.getText(parsed))) {
      for (const argument of node.arguments) {
        if (directMessage(argument) && errorValue(argument) && !sanitized(argument)) mark(node)
      }
    }
    if (ts.isReturnStatement(node) && node.expression && !ts.isObjectLiteralExpression(node.expression) && directMessage(node.expression)) {
      let parent: ts.Node | undefined = node.parent
      let checked = false
      while (parent && !ts.isFunctionLike(parent)) {
        if (ts.isIfStatement(parent)) { checked ||= errorCheck(parent.expression) }
        parent = parent.parent
      }
      if (!sanitized(node) && (checked || errorValue(node.expression))) mark(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  // 既存の直接 return の形も、構文を解析する見張りと併用する。
  code(source).split('\n').forEach((line, index) => {
    if (RAW_MESSAGE.test(line) && !line.includes('extractApiErrorMessage')) lines.add(index)
  })
  return lines.size
}

function collect(dir: string, found: Record<string, number> = {}): Record<string, number> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === 'generated') continue
      collect(full, found)
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\.tsx?$/.test(entry.name)) {
      const n = countRawMessageLines(fs.readFileSync(full, 'utf8'))
      if (n > 0) found[path.relative(SRC, full)] = n
    }
  }
  return found
}

/* 表示には使わないコード・通信・競合の判定だけ。元の27か所の残りを用途別に記録する。 */
const BASELINE: Record<string, number> = {
  'app/updates/page.tsx': 1,
  'components/webinars/webinar-error-text.ts': 1,
  'v8/analytics/cross.tsx': 1,
  'v8/analytics/funnel.tsx': 2,
  'v8/conversions/list.tsx': 1,
  'v8/login/two-factor/two-factor-error.ts': 1,
}

describe('「API error: 500」を画面に出さない', () => {
  it('見張りの形が、そのまま出す書き方を拾い、弾いている書き方は拾わない', () => {
    expect(countRawMessageLines("setError(caught instanceof Error ? caught.message : '保存できませんでした')")).toBe(1)
    expect(countRawMessageLines("if (error instanceof ApiError && error.message) return error.message")).toBe(1)
    expect(countRawMessageLines("return caught instanceof ApiError && caught.message && !/^API error: /.test(caught.message) ? caught.message : fb")).toBe(1)
    expect(countRawMessageLines("return japaneseDetailOf(caught) || '保存できませんでした'")).toBe(0)
  })

  it.each([
    "setError(error.message)",
    "try {} catch (problem) { setError(otpFailureMessage(problem.message)) }",
    "request.catch(problem => setError(problem.message))",
    "request.catch(function(problem) { setError(otpFailureMessage(problem.message)) })",
    "setError(error.message || '保存できませんでした')",
    "setError(error.message ?? '保存できませんでした')",
    "setError(caught?.message)",
    "setError((e as Error).message)",
    "setError(e.message.slice(0, 80))",
    "try {} catch (problem) { const alias = problem as Error; setError(alias?.message) }",
    "return e instanceof ApiError && !/^API error: /.test(e.message) ? e.message : fallback",
    "return error.message",
    "if (!(error instanceof ApiError)) return '失敗'; return error.message",
    "setError(`保存できませんでした（${error.message}）`)",
    "setNotice({ tone: 'error', text: error.message })",
    "const message = error instanceof ApiError ? `失敗（${error.message}）` : '失敗しました'",
    "const message = error instanceof ApiError && error.status === 400\n ? error.message\n : '失敗しました'",
    "if (error instanceof ApiError) { if (error.status === 400) return error.message }",
    "setError(error instanceof ApiError ? error.message : 'API errorを表示しない')",
    "return error instanceof ApiError && (!/^API error: /.test(error.message) || allowed) ? error.message : fallback",
  ])('原文表示の故障を拾う: %s', source => {
    expect(countRawMessageLines(source)).toBeGreaterThan(0)
  })

  it.each([
    "setError(describeApiFailure(error, '保存'))",
    "try {} catch (problem) { setError(otpFailureMessage(describeApiFailure(problem, '保存'))) }",
    "setError(japaneseDetailOf(error) || '保存できませんでした')",
    "const detail = extractApiErrorMessage(JSON.stringify({error: caught instanceof Error ? caught.message : ''}), 400)",
    "const code = extractApiErrorCode(error instanceof Error ? error.message : '')",
  ])('共通表示の呼び出しとコードへの変換は表示の直接代入にしない: %s', source => {
    // 最後の形は既存のコード判定用の持ち越しとして全画面の検査で監視する。
    expect(countRawMessageLines(source)).toBe(source.includes('extractApiErrorCode') ? 1 : 0)
  })

  it('message をそのまま画面に出す箇所を増やさない（japaneseDetailOf・describeSaveFailure に寄せる）', () => {
    const found = collect(SRC)
    const grown = Object.entries(found)
      .filter(([file, n]) => n > (BASELINE[file] ?? 0))
      .map(([file, n]) => `${file}: ${n}（持ち越し ${BASELINE[file] ?? 0}）`)
    expect(grown, '「API error: 500」が画面に出ます。japaneseDetailOf(err) || 案内文 に寄せてください').toEqual([])
  })

  it('点検で見つけた8か所は直したまま', () => {
    for (const file of [
      'v8/restaurant/google/format.ts',
      'v8/friends/migrations/use-uid-migration.ts',
      'app/accounts/use-uid-migration.ts',
      'v8/hq-broadcasts/create.tsx',
      'v8/hq-broadcasts/detail.tsx',
    ]) {
      expect(BASELINE[file] ?? 0, file).toBe(0)
    }
    const closures = fs.readFileSync(path.join(SRC, 'v8/restaurant/closures/closures.tsx'), 'utf8')
    expect(countRawMessageLines(closures)).toBe(0)
  })
})
