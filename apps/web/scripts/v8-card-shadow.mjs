import fs from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import ts from 'typescript'

export function cssCandidates(source) {
  const out = []
  postcss.parse(source).walkRules(rule => {
    const d = Object.fromEntries((rule.nodes ?? []).filter(n => n.type === 'decl').map(n => [n.prop, n.value]))
    const ring = /var\(--tpl-[a-z0-9-]*ring/.test(d['box-shadow'] ?? '')
    const framed = /(?:12px|var\(--(?:radius-card|tpl-[a-z0-9-]*radius)\))/.test(d['border-radius'] ?? '') && /hairline/.test((d.border ?? '') + (d.outline ?? '')) && !d['box-shadow']
    if (ring || framed) out.push(rule.selector)
  })
  return out
}

export function classCandidates(source) {
  const ast = ts.createSourceFile('screen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out = []
  function visit(n) {
    if (ts.isJsxAttribute(n) && n.name.text === 'className' && n.initializer) {
      const texts = []
      function literals(q) {
        if (ts.isStringLiteral(q) || ts.isNoSubstitutionTemplateLiteral(q) || ts.isTemplateExpression(q)) texts.push(q.getText(ast))
        else ts.forEachChild(q, literals)
      }
      literals(n.initializer)
      if (texts.some(t => t.includes('rounded-card') && t.includes('border') && t.includes('hairline') && !t.includes('shadow-') && !t.includes('content-card'))) out.push(n.getText(ast))
    }
    ts.forEachChild(n, visit)
  }
  visit(ast)
  return out
}

export function audit(src) {
  const files = []
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (!file.includes('.test.') && /\.(tsx?|css)$/.test(file)) files.push(file)
    }
  }
  walk(src)
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
  for (const file of files.filter(f => f.includes('/v8/') || /v8[^/]*\.tsx$/.test(f))) scan(file)
  return files.flatMap(file => {
    const name = path.relative(src, file)
    const body = fs.readFileSync(file, 'utf8')
    if (file.endsWith('.module.css') && (file.includes('/v8/') || /-v8.module.css$/.test(file))) return cssCandidates(body).map(selector => ({ file: name, selector }))
    if (file.endsWith('.tsx') && active.has(file)) return classCandidates(body).map(selector => ({ file: name, selector }))
    return []
  })
}
