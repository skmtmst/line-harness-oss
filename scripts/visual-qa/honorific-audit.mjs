import ts from 'typescript'

const honorific = /^\s*[」”]?\s*(?:さん|様|さま)/u
const nameExpression = /name\b/iu

/** JSX・テンプレート・文字列連結を構文で読み、コメントや差し込みの見本文は数えない。 */
export function directHonorifics({ file, source }) {
  if (!/(?:さん|様|さま)/u.test(source)) return []
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.jsx') ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  const findings = []
  const add = (expression, text) => {
    if (!honorific.test(text) || !nameExpression.test(expression.getText(tree))) return
    findings.push({
      file,
      line: tree.getLineAndCharacterOfPosition(expression.getStart(tree)).line + 1,
      expression: expression.getText(tree).replace(/\s+/g, ' '),
      suffix: text.match(honorific)[0],
    })
  }
  const visit = node => {
    if (ts.isTemplateExpression(node)) {
      node.templateSpans.forEach((span, index) => {
        let suffix = span.literal.text
        for (const next of node.templateSpans.slice(index + 1)) {
          if (suffix.trim() || !ts.isStringLiteralLike(next.expression)) break
          suffix += next.expression.text + next.literal.text
        }
        add(span.expression, suffix)
      })
    }
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      node.children.forEach((child, index) => {
        let previousIndex = index - 1
        while (previousIndex >= 0) {
          const sibling = node.children[previousIndex]
          const text = ts.isJsxText(sibling) ? sibling.text : ts.isJsxExpression(sibling) && sibling.expression && ts.isStringLiteralLike(sibling.expression) ? sibling.expression.text : undefined
          if (text === undefined || text.trim()) break
          previousIndex--
        }
        const previous = node.children[previousIndex]
        if (!previous || !ts.isJsxExpression(previous) || !previous.expression) return
        if (ts.isJsxText(child)) add(previous.expression, child.text)
        if (ts.isJsxExpression(child) && child.expression && ts.isStringLiteralLike(child.expression)) add(previous.expression, child.expression.text)
      })
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      let right = node.right
      while (ts.isParenthesizedExpression(right)) right = right.expression
      if (ts.isStringLiteralLike(right)) add(node.left, right.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return findings
}

/** 行の移動を違反の追加と誤認せず、同じ手書きの複製も増加として検出する。 */
export function addedHonorifics(before, after) {
  const key = row => JSON.stringify([row.file, row.expression, row.suffix])
  const remaining = new Map()
  for (const row of before) remaining.set(key(row), (remaining.get(key(row)) ?? 0) + 1)
  return after.filter(row => {
    const count = remaining.get(key(row)) ?? 0
    if (!count) return true
    remaining.set(key(row), count - 1)
    return false
  })
}
