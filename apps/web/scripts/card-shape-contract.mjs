import fs from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import ts from 'typescript'

export function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name)
    return entry.isDirectory() ? sourceFiles(file) : [file]
  }).sort()
}

// globals の V8 の値を使う。部品内の一時変数は全画面へ漏らさない。
export function globalTokens(css) {
  const tokens = new Map()
  postcss.parse(css).walkDecls(/^--/, decl => {
    const parent = decl.parent
    if (parent.type === 'atrule' && parent.name === 'theme' ||
        parent.type === 'rule' && /^(?::root|(?:html)?\[data-theme=["']v8["']\])$/.test(parent.selector)) {
      tokens.set(decl.prop, decl.value)
    }
  })
  return tokens
}

export function resolveValue(value, tokens, seen = new Set()) {
  // var() の括弧を数え、入れ子のフォールバックも解く。
  let out = '', cursor = 0
  while (true) {
    const start = value.indexOf('var(', cursor)
    if (start < 0) return out + value.slice(cursor)
    out += value.slice(cursor, start)
    let depth = 1, end = start + 4
    while (end < value.length && depth) {
      if (value[end] === '(') depth++
      if (value[end] === ')') depth--
      end++
    }
    if (depth) return out + value.slice(start)
    const inner = value.slice(start + 4, end - 1)
    const comma = inner.indexOf(',')
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim()
    const fallback = comma < 0 ? undefined : inner.slice(comma + 1).trim()
    const replacement = seen.has(name) ? undefined : tokens.get(name) ?? fallback
    out += replacement === undefined ? value.slice(start, end) : resolveValue(replacement, tokens, new Set([...seen, name]))
    cursor = end
  }
}

const compact = value => value.replace(/\s+/g, '')

export function cssShapeCandidates(css, tokens) {
  const rules = new Map()
  postcss.parse(css).walkRules(rule => {
    // 同じセレクタの分割宣言を合わせる。@media 等は別の規則として扱う。
    const context = []
    for (let p = rule.parent; p && p.type !== 'root'; p = p.parent) {
      context.unshift(p.type === 'atrule' ? `@${p.name} ${p.params}` : p.selector)
    }
    const selector = rule.selector.replace(/\s+/g, ' ').trim()
    const key = [...context, selector].join(' | ')
    const entry = rules.get(key) ?? { selector, declarations: {}, context }
    for (const node of rule.nodes ?? []) {
      if (node.type === 'decl') entry.declarations[node.prop] = node.value
    }
    rules.set(key, entry)
  })
  const hits = []
  for (const { selector, declarations: d } of rules.values()) {
    const local = new Map(tokens)
    for (const [prop, value] of Object.entries(d)) if (prop.startsWith('--')) local.set(prop, value)
    const radius = resolveValue(d['border-radius'] ?? '', local).trim()
    if (!/^(?:12px\s*){1,4}$/.test(radius)) continue
    const frame = [d.border, d['border-color'], d.outline, d['outline-color'], d['box-shadow']].filter(Boolean).join(' ')
    const resolvedFrame = compact(resolveValue(frame, local))
    const framed = /hairline|card-edge|var\(--tpl-[\w-]*ring/.test(frame) ||
      ['--color-hairline', '--card-edge'].some(token => local.has(token) && resolvedFrame.includes(compact(resolveValue(`var(${token})`, local))))
    const shadow = compact(resolveValue(d['box-shadow'] ?? '', local))
    const cardShadow = compact(resolveValue('var(--card-shadow)', local))
    if (framed && !shadow.includes(cardShadow)) hits.push(selector)
  }
  return [...new Set(hits)]
}

export function classShapeCandidates(source, tokens) {
  const ast = ts.createSourceFile('screen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const definitions = new Map()
  function collect(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) definitions.set(node.name.text, node.initializer)
    ts.forEachChild(node, collect)
  }
  collect(ast)
  const combine = (a, b) => a.flatMap(left => b.map(right => `${left} ${right}`))
  function values(node, seen = new Set()) {
    if (!node) return ['']
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text]
    if (ts.isJsxExpression(node) || ts.isParenthesizedExpression(node)) return values(node.expression, seen)
    if (ts.isConditionalExpression(node)) return [...values(node.whenTrue, seen), ...values(node.whenFalse, seen)]
    if (ts.isIdentifier(node) && definitions.has(node.text) && !seen.has(node.text)) return values(definitions.get(node.text), new Set([...seen, node.text]))
    if (ts.isTemplateExpression(node)) return node.templateSpans.reduce((out, span) => combine(out, values(span.expression, seen).map(value => `${value} ${span.literal.text}`)), [node.head.text])
    if (ts.isBinaryExpression(node)) {
      const right = values(node.right, seen)
      if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return ['', ...right]
      if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return combine(values(node.left, seen), right)
      return [...values(node.left, seen), ...right]
    }
    if (ts.isCallExpression(node) && /^(?:clsx|cn|cx|classNames)$/.test(node.expression.getText(ast))) return node.arguments.reduce((out, arg) => combine(out, values(arg, seen)), [''])
    if (ts.isArrayLiteralExpression(node)) return node.elements.reduce((out, arg) => combine(out, values(arg, seen)), [''])
    return ['']
  }
  function hasCardShadow(classes) {
    if (classes.includes('content-card')) return true
    const expected = compact(resolveValue('var(--card-shadow)', tokens))
    return classes.some(name => name.startsWith('shadow-') && tokens.has(`--${name}`) && compact(resolveValue(`var(--${name})`, tokens)).includes(expected))
  }
  const hits = []
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'className' && node.initializer) {
      if (values(node.initializer).some(value => {
        const classes = value.split(/\s+/)
        return classes.includes('rounded-card') && classes.includes('border-hairline') && !hasCardShadow(classes)
      })) hits.push(node.getText(ast).replace(/\s+/g, ' '))
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return [...new Set(hits)]
}

// V8 の入口から使う部品も読む。旧い画面の分岐だけは変更しない。
export function v8Sources(src, files = sourceFiles(src)) {
  const active = new Set()
  function scan(file) {
    if (active.has(file)) return
    active.add(file)
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/(?:from\s*|import\s*\()(['"])(.*?)\1/g)) {
      const spec = match[2]
      const resolved = spec.startsWith('@/') ? path.join(src, spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(file), spec) : null
      if (!resolved) continue
      const next = [resolved, resolved + '.tsx', resolved + '.ts', path.join(resolved, 'index.tsx'), path.join(resolved, 'index.ts')].find(f => fs.existsSync(f) && fs.statSync(f).isFile())
      if (next) scan(next)
    }
  }
  for (const file of files.filter(f => !f.includes('.test.') && (f.includes('/v8/') || /v8[^/]*\.tsx$/.test(f)))) scan(file)
  return [...active].filter(file => /\.tsx?$/.test(file) && !file.includes('.test.')).sort()
}
