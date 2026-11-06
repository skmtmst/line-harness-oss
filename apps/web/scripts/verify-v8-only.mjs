import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import postcss from 'postcss'

const WEB = fileURLToPath(new URL('../', import.meta.url))
const isTest = name => /(?:^|\/)(?:test-utils|__tests__)(?:\/|$)|\.(?:test|spec|test-support)\.[^.]+$/.test(name)
const filesIn = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name)
  return entry.isDirectory() ? filesIn(path) : [path]
})

/** 現役のコードだけを調べる。試験の負の例とAPIの機能番号は対象外。 */
export function inspectSource(name, source) {
  if (isTest(name)) return []
  const findings = new Set()
  const fail = reason => findings.add(`${name}: ${reason}`)
  if (/(?:-|\.)v[67]\.(?:tsx?|css|mjs)$/.test(basename(name))) fail('legacy appearance file')
  if (name.endsWith('.css')) {
    const root = postcss.parse(source, { from: name })
    root.walkRules(rule => {
      if (/data-theme|\.v7-only\b|\.v8-only\b|\.v7-refresh\b/.test(rule.selector)) fail('conditional appearance selector')
    })
    root.walkAtRules(rule => {
      if (rule.name === 'custom-variant' && /^v[678]\b/.test(rule.params)) fail('theme Tailwind variant')
      if (rule.name === 'keyframes' && /^v[67]-/.test(rule.params)) fail('legacy appearance animation')
    })
    return [...findings]
  }
  const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const forbiddenNames = new Set(['useAdminTheme', 'AdminTheme', 'NEXT_PUBLIC_ADMIN_THEME'])
  const visit = node => {
    if (ts.isIdentifier(node) && forbiddenNames.has(node.text)) fail(`theme switch ${node.text}`)
    if (ts.isStringLiteralLike(node)) {
      if (/use-admin-theme|admin-theme-default|lh_admin_theme|NEXT_PUBLIC_ADMIN_THEME/.test(node.text)) fail('legacy theme source or storage')
      if (/(?:^|\s)v[678]:/.test(node.text) || /\bv[78]-only\b/.test(node.text)) fail('conditional appearance class')
      if (/(?:-|\.)v[67](?:\.[cm]?[jt]sx?)?$/.test(node.text)) fail('legacy appearance import')
    }
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'data-theme') {
      if (!node.initializer || !ts.isStringLiteral(node.initializer) || node.initializer.text !== 'v8') fail('mutable theme attribute')
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'theme' && node.expression.getText(ast).endsWith('.dataset')) {
      fail('runtime theme branch or assignment')
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return [...findings]
}

export function verify(web = WEB) {
  const candidates = filesIn(join(web, 'src')).filter(file => /\.(?:tsx?|css)$/.test(file))
  for (const name of ['next.config.ts', 'next.config.mjs', 'tailwind.config.ts']) {
    if (existsSync(join(web, name))) candidates.push(join(web, name))
  }
  return candidates.flatMap(file => inspectSource(relative(web, file).replaceAll('\\', '/'), readFileSync(file, 'utf8')))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = verify()
  if (findings.length) {
    console.error(findings.join('\n'))
    process.exitCode = 1
  } else console.log('V8 only: no legacy appearance switch, source, CSS condition or Tailwind variant')
}
