#!/usr/bin/env node
/**
 * 型の対応表（docs/v8-pattern-catalog.md）の機械の表 v8-pattern-catalog.json を読み、
 * 型ごとに「持ち主（正の部品）以外で同じ形を作っている所」を探す（B-143・B-168・B-172）。
 *
 *   node scripts/visual-qa/v8-pattern-audit.mjs \
 *     --code ~/lh-work/lh-train-12 --pen ~/lh-work/design/v8/html \
 *     --out ~/lh-work/design/v8/review/pattern-audit-run [--only card,kpi-band] [--top 15]
 *
 * 型ごとに4つを数える（B-172）。
 *   (a) 手書き：持ち主以外で同じ形を作っている所（コードの目印。file:line）
 *   (b) 上書き：画面が部品の見た目を上書きしている所
 *       - 部品に className / style を渡している（JSX）
 *       - 画面の .module.css が部品の中身を子孫・属性・:global で塗り直している
 *   (c) 直書き：画面の CSS に色・大きさ・角丸・影を変数なしで書いている所（型は selector の手がかりで割り当て、
 *       当たらない分は「（型なし）」）
 *   (d) Pen：板で持ち主の部品を切り離した・見た目を上書きした所（部品の板の html と同じ名前の節を比べる。
 *       文字・件数・データの違いは数えない）、と手描きの目印（板 ID）
 * 効く範囲：持ち主の部品を読んでいる画面側のファイル数・機能の数、Pen は部品を置いている板の数。
 *
 * 出力：<out>/pattern-audit.json と <out>/pattern-audit.md。数は「候補」なので、直す前に目で確かめる。
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_CATALOG = join(HERE, 'v8-pattern-catalog.json')

const CODE_ROOTS = ['apps/web/src', 'apps/liff/src']
const CODE_EXT = /\.(tsx?|css)$/
const SKIP_DIRS = new Set(['node_modules', '.next', 'out', 'dist', 'coverage', '.turbo'])
const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'use', 'stop'])
const NO_TYPE = '（型なし）'

function expandHome(p) {
  return p && p.startsWith('~/') ? join(homedir(), p.slice(2)) : p
}

function rx(source, flags = '') {
  try {
    return new RegExp(source, flags)
  } catch (error) {
    throw new Error(`正規表現が読めない: /${source}/ (${error.message})`)
  }
}

export function loadCatalog(path = DEFAULT_CATALOG) {
  const catalog = JSON.parse(readFileSync(path, 'utf8'))
  return compileCatalog(catalog)
}

export function compileCatalog(catalog) {
  const g = catalog.global ?? {}
  catalog._global = {
    excludeFiles: (g.code?.excludeFiles ?? []).map((s) => rx(s)),
    excludeLine: (g.code?.excludeLine ?? []).map((s) => rx(s)),
    hardcodeExcludeFiles: (g.code?.hardcodeExcludeFiles ?? []).map((s) => rx(s)),
    penExcludeBoards: (g.pen?.excludeBoards ?? []).map((s) => rx(s)),
    penAncestorNot: (g.pen?.ancestorNot ?? []).map((s) => rx(s)),
    penCompare: g.pen?.compareProps ?? ['background-color', 'outline', 'box-shadow', 'border-radius'],
  }
  for (const pattern of catalog.patterns) compilePattern(pattern, catalog)
  return catalog
}

/** JSON の文字列を RegExp にしておく（読めない式はここで落とす）。 */
export function compilePattern(pattern, catalog = { _global: { excludeFiles: [], excludeLine: [], penExcludeBoards: [], penAncestorNot: [] } }) {
  const code = pattern.code ?? {}
  const owner = pattern.owner?.code ?? {}
  const glob = catalog._global
  const components = owner.components ?? []
  pattern._code = {
    excludeFiles: [...glob.excludeFiles, ...(code.excludeFiles ?? []).map((s) => rx(s)), ...(owner.files ?? []).map((f) => rx(`${escapeRe(f)}$`))],
    ownerFiles: (owner.files ?? []).map((f) => rx(`${escapeRe(f)}$`)),
    canonicalUse: code.canonicalUse ? rx(code.canonicalUse) : (components.length ? rx(`<(${components.map(escapeRe).join('|')})\\b|\\b(${components.map(escapeRe).join('|')})\\(`) : null),
    // 部品に className / style を渡す（JSX の中の => は通す）
    propOverride: components.length ? rx(`<(${components.map(escapeRe).join('|')})\\b(?:[^<>]|=>){0,800}?\\s(className|style)=`, 'gm') : null,
    overrideSelectors: (code.overrideSelectors ?? []).map((s) => rx(s, 'i')),
    selectorHint: code.selectorHint ? rx(code.selectorHint, 'i') : null,
    excludeLine: [...glob.excludeLine, ...(code.excludeLine ?? []).map((s) => rx(s))],
    signals: (code.signals ?? []).map((signal) => ({
      ...signal,
      _re: signal.re ? rx(signal.re, 'gm') : null,
      _file: signal.files ? rx(signal.files) : null,
      _all: (signal.css?.all ?? []).map((s) => rx(s, 'i')),
      _none: (signal.css?.none ?? []).map((s) => rx(s, 'i')),
    })),
  }
  const pen = pattern.pen ?? {}
  pattern._pen = {
    excludeBoards: [...glob.penExcludeBoards, ...(pen.excludeBoards ?? []).map((s) => rx(s))],
    ancestorNot: [...glob.penAncestorNot, ...(pen.ancestorNot ?? []).map((s) => rx(s))],
    markers: (pen.markers ?? []).map((marker) => ({
      ...marker,
      _name: marker.name ? rx(marker.name) : null,
      _nameNot: marker.nameNot ? rx(marker.nameNot) : null,
      _style: (marker.style ?? []).map((s) => rx(s)),
      _styleNot: (marker.styleNot ?? []).map((s) => rx(s)),
      _text: marker.text ? rx(marker.text) : null,
      _textNot: marker.textNot ? rx(marker.textNot) : null,
      _ancestor: marker.ancestor ? rx(marker.ancestor) : null,
    })),
  }
  return pattern
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function walkFiles(root, test = CODE_EXT) {
  const out = []
  if (!existsSync(root)) return out
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (test.test(entry.name)) out.push(path)
    }
  }
  visit(root)
  return out.sort()
}

/** 置き場で分ける。shared＝持ち主の側（共通部品・型・外側・LIFF の部品）。 */
export function scopeOf(rel) {
  if (/\/components\/(shared|templates|layout|ui)\//.test(rel) || rel.startsWith('apps/liff/src/components/')) return rel.startsWith('apps/liff/') ? 'liff-shared' : 'shared'
  if (rel.startsWith('apps/liff/')) return 'liff'
  if (rel.includes('/src/v8/') || /-v8(\.module)?\.(tsx|css)$/.test(rel)) return 'v8'
  return 'other'
}

const isOwnerSide = (scope) => scope === 'shared' || scope === 'liff-shared'

/** 直すと効く画面のまとまり（機能）の名前。 */
export function featureOf(rel) {
  let m = rel.match(/apps\/web\/src\/v8\/([^/]+)/)
  if (m) return `v8/${m[1]}`
  m = rel.match(/apps\/web\/src\/app\/((?:\([^)]*\)\/)?[^/]+)/)
  if (m) return `app/${m[1]}`
  m = rel.match(/apps\/web\/src\/components\/([^/]+)/)
  if (m) return `components/${m[1]}`
  m = rel.match(/apps\/liff\/src\/([^/]+(?:\/[^/]+)?)/)
  if (m) return `liff/${m[1]}`
  return rel
}

function lineAt(content, index) {
  let line = 1
  for (let i = 0; i < index && i < content.length; i += 1) if (content.charCodeAt(i) === 10) line += 1
  return line
}

const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|\{\s*\/\*)/

/** CSS を規則ごとに分ける（@media の中も拾う）。コメントは空白にして行の番号を保つ。 */
export function cssRules(content) {
  const clean = content.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  const rules = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(clean))) {
    const selector = m[1].trim()
    if (!selector || selector.startsWith('@')) continue
    const lead = m[1].length - m[1].trimStart().length
    rules.push({ selector, body: m[2], index: m.index + lead, bodyIndex: m.index + m[1].length + 1 })
  }
  return rules
}

/** (a) 1つのファイルに型の目印を当てる。 */
export function scanCodeFile(pattern, rel, content, glob = { excludeFiles: [] }) {
  const p = pattern._code
  if (p.excludeFiles.some((re) => re.test(rel))) return []
  const usesCanonical = p.canonicalUse ? p.canonicalUse.test(content) : false
  const lines = content.split('\n')
  const hits = []
  const seen = new Set()
  for (const signal of p.signals) {
    if (signal._file && !signal._file.test(rel)) continue
    if (signal.onlyWithoutCanonical && usesCanonical) continue
    if (signal.css) {
      if (!rel.endsWith('.css')) continue
      for (const rule of cssRules(content)) {
        const block = `${rule.selector}{${rule.body}}`
        if (!signal._all.every((re) => re.test(block))) continue
        if (signal._none.some((re) => re.test(block))) continue
        const line = lineAt(content, rule.index)
        if (seen.has(line)) continue
        seen.add(line)
        hits.push({ line, signal: signal.id, why: signal.why, text: rule.selector.replace(/\s+/g, ' ').slice(0, 180) })
      }
      continue
    }
    if (!signal._re) continue
    if (signal.ext && !rel.endsWith(signal.ext)) continue
    signal._re.lastIndex = 0
    let m
    while ((m = signal._re.exec(content))) {
      if (m[0].length === 0) { signal._re.lastIndex += 1; continue }
      const line = lineAt(content, m.index)
      const raw = lines[line - 1] ?? ''
      const text = raw.trim().slice(0, 180)
      if (COMMENT_LINE.test(raw)) continue
      if (p.excludeLine.some((re) => re.test(text))) continue
      if (seen.has(line)) continue
      seen.add(line)
      hits.push({ line, signal: signal.id, why: signal.why, text })
    }
  }
  return hits.map((hit) => ({ ...hit, file: rel, scope: scopeOf(rel), usesCanonical }))
}

/** (b) JSX：持ち主の部品に className / style を渡している所。 */
export function scanPropOverrides(pattern, rel, content) {
  const p = pattern._code
  if (!p.propOverride || !/\.tsx$/.test(rel) || isOwnerSide(scopeOf(rel))) return []
  const lines = content.split('\n')
  const hits = []
  p.propOverride.lastIndex = 0
  let m
  while ((m = p.propOverride.exec(content))) {
    const at = m.index + m[0].length - m[2].length - 1
    const line = lineAt(content, at)
    hits.push({ file: rel, line, kind: `prop:${m[2]}`, component: m[1], text: (lines[line - 1] ?? '').trim().slice(0, 180), scope: scopeOf(rel) })
  }
  return hits
}

const VISUAL_PROP = /^(color|background(-color)?|border(-[a-z]+)*|outline(-[a-z]+)*|box-shadow|font-(size|weight)|line-height|height|min-height|max-height|width|min-width|max-width|padding(-[a-z]+)*|gap|opacity|fill|stroke)$/
const OVERRIDE_SELECTOR = /:global\((?!\s*\[data-theme)|\s(button|input|select|textarea|table|thead|tbody|tr|th|td|label|svg|a)\b|\[(data-[a-z-]+|role|aria-[a-z-]+)|>\s*\*|\s\*/

function stripThemeScope(selector) {
  return selector.replace(/:global\(\s*\[data-theme[^)]*\)\s*\)/g, '').replace(/:global\(\s*\[data-theme[^)]*\]\s*\)/g, '').trim()
}

function declarations(body) {
  return body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(':')
    return i < 0 ? null : { prop: d.slice(0, i).trim().toLowerCase(), value: d.slice(i + 1).trim() }
  }).filter(Boolean)
}

/** (b) CSS：画面の .module.css が部品の中身を塗り直している所。型は overrideSelectors で割り当てる。 */
export function scanCssOverrides(patterns, rel, content) {
  if (!rel.endsWith('.module.css') || isOwnerSide(scopeOf(rel))) return []
  const hits = []
  for (const rule of cssRules(content)) {
    const selector = stripThemeScope(rule.selector)
    if (!OVERRIDE_SELECTOR.test(` ${selector}`)) continue
    const visual = declarations(rule.body).filter((d) => VISUAL_PROP.test(d.prop))
    if (!visual.length) continue
    const owner = patterns.find((p) => p._code.overrideSelectors.some((re) => re.test(selector)))
    hits.push({ file: rel, line: lineAt(content, rule.index), kind: 'css', pattern: owner?.id ?? NO_TYPE, text: selector.replace(/\s+/g, ' ').slice(0, 160), scope: scopeOf(rel) })
  }
  return hits
}

const COLOR_VALUE = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(|\b(white|black|red|green|blue|gray|grey|orange|yellow)\b/i
const LENGTH_VALUE = /(^|[\s(,])-?\d*\.?\d+(px|rem|em)\b/
const HARD_PROPS = {
  color: /^(color|background(-color)?|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|fill|stroke|text-decoration-color|caret-color|accent-color)$/,
  size: /^(font-size|height|min-height|max-height|width|min-width|max-width|line-height)$/,
  radius: /^border(-(top|bottom)-(left|right))?-radius$/,
  shadow: /^box-shadow$/,
}

/** 変数を読まずに書いた値か（var() の中の予備の値は数えない）。 */
export function hardcodedKind(prop, value) {
  const bare = value.replace(/var\([^()]*(\([^()]*\))?[^()]*\)/g, ' ').replace(/!important/g, '')
  if (HARD_PROPS.shadow.test(prop)) return /none|inherit|unset|initial/.test(bare.trim()) || !bare.trim() ? null : (COLOR_VALUE.test(bare) || LENGTH_VALUE.test(bare) ? 'shadow' : null)
  if (HARD_PROPS.radius.test(prop)) {
    if (!LENGTH_VALUE.test(bare)) return null
    return /^(0|0px)$/.test(bare.trim()) ? null : 'radius'
  }
  if (HARD_PROPS.color.test(prop)) return COLOR_VALUE.test(bare) ? 'color' : null
  if (HARD_PROPS.size.test(prop)) {
    if (/^(0|0px|1px|100%|auto|none|inherit|fit-content|max-content|min-content)$/.test(bare.trim())) return null
    if (prop === 'line-height' && !/px|rem|em/.test(bare)) return null
    return LENGTH_VALUE.test(bare) ? 'size' : null
  }
  return null
}

/** (c) 画面の CSS の直書き（色・大きさ・角丸・影）。 */
export function scanHardcoded(patterns, rel, content, glob) {
  if (!rel.endsWith('.css') || isOwnerSide(scopeOf(rel))) return []
  if (glob.hardcodeExcludeFiles.some((re) => re.test(rel))) return []
  const hits = []
  for (const rule of cssRules(content)) {
    const selector = stripThemeScope(rule.selector)
    if (/^(:root|html|body)\b/.test(selector)) continue
    const owner = patterns.find((p) => p._code.selectorHint && p._code.selectorHint.test(selector))
    let offset = 0
    for (const raw of rule.body.split(';')) {
      const at = rule.bodyIndex + offset
      offset += raw.length + 1
      const i = raw.indexOf(':')
      if (i < 0) continue
      const prop = raw.slice(0, i).trim().toLowerCase()
      const value = raw.slice(i + 1).trim()
      if (prop.startsWith('--')) continue
      const kind = hardcodedKind(prop, value)
      if (!kind) continue
      const lead = raw.length - raw.trimStart().length
      hits.push({ file: rel, line: lineAt(content, at + lead), kind, pattern: owner?.id ?? NO_TYPE, text: `${selector.replace(/\s+/g, ' ').slice(0, 80)} { ${prop}: ${value} }`.slice(0, 180), scope: scopeOf(rel) })
    }
  }
  return hits
}

export function scanCode(catalog, codeRoot, patterns = catalog.patterns) {
  const glob = catalog._global
  const files = CODE_ROOTS.flatMap((sub) => walkFiles(join(codeRoot, sub)))
  const a = Object.fromEntries(patterns.map((p) => [p.id, []]))
  const b = Object.fromEntries([...patterns.map((p) => [p.id, []]), [NO_TYPE, []]])
  const c = Object.fromEntries([...patterns.map((p) => [p.id, []]), [NO_TYPE, []]])
  const usage = Object.fromEntries(patterns.map((p) => [p.id, { files: new Set(), features: new Set() }]))
  let scanned = 0
  for (const path of files) {
    const rel = relative(codeRoot, path).split('\\').join('/')
    if (glob.excludeFiles.some((re) => re.test(rel))) continue
    scanned += 1
    const content = readFileSync(path, 'utf8')
    const scope = scopeOf(rel)
    for (const pattern of patterns) {
      a[pattern.id].push(...scanCodeFile(pattern, rel, content, glob))
      for (const hit of scanPropOverrides(pattern, rel, content)) b[pattern.id].push({ ...hit, pattern: pattern.id })
      if (!isOwnerSide(scope) && /\.tsx?$/.test(rel) && pattern._code.canonicalUse?.test(content)) {
        usage[pattern.id].files.add(rel)
        usage[pattern.id].features.add(featureOf(rel))
      }
    }
    for (const hit of scanCssOverrides(patterns, rel, content)) b[hit.pattern].push(hit)
    for (const hit of scanHardcoded(patterns, rel, content, glob)) c[hit.pattern].push(hit)
  }
  const reach = Object.fromEntries(Object.entries(usage).map(([id, u]) => [id, { files: u.files.size, features: u.features.size }]))
  return { files: scanned, a, b, c, reach }
}

function attrs(source) {
  const out = {}
  const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g
  let m
  while ((m = re.exec(source))) out[m[1]] = m[3] ?? m[4] ?? ''
  return out
}

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

/** 板の html を、名前・style・直下の文字・祖先の名前の並びにする（end＝子孫の終わりの番号）。 */
export function penNodes(html) {
  const nodes = []
  const stack = []
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g
  let m
  while ((m = re.exec(html))) {
    const [, closing, rawTag, rest, selfClose] = m
    const tag = rawTag.toLowerCase()
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].tag === tag) {
          for (let j = stack.length - 1; j >= i; j -= 1) if (stack[j].node != null) nodes[stack[j].node].end = nodes.length
          stack.length = i
          break
        }
      }
      continue
    }
    const a = attrs(rest)
    const next = html.indexOf('<', re.lastIndex)
    const text = decode(html.slice(re.lastIndex, next === -1 ? undefined : next).replace(/\s+/g, ' ').trim())
    const name = a['data-pencil-name'] != null ? decode(a['data-pencil-name']) : null
    let index = null
    if (name != null) {
      index = nodes.length
      nodes.push({ name, id: a['data-pencil-id'] ?? null, style: a.style ?? '', text, ancestors: stack.map((s) => s.name).filter(Boolean), end: index + 1 })
    }
    if (!selfClose && !VOID_TAGS.has(tag)) stack.push({ tag, name, node: index })
    else if (index != null) nodes[index].end = nodes.length
  }
  for (const s of stack) if (s.node != null) nodes[s.node].end = nodes.length
  return nodes
}

export function styleProps(style) {
  const out = {}
  for (const d of declarations(style)) out[d.prop] = d.value.replace(/\s+/g, ' ')
  return out
}

function descendantNames(nodes, index) {
  const names = new Set()
  for (let i = index + 1; i < nodes[index].end; i += 1) names.add(nodes[i].name)
  return names
}

/** 部品の板（components-*.html）から、持ち主の Pen 部品の形を読む。 */
export function loadPenComponents(penDir) {
  const defs = {}
  if (!penDir || !existsSync(penDir)) return defs
  for (const file of readdirSync(penDir).filter((f) => /^components-.*\.html$/.test(f))) {
    const nodes = penNodes(readFileSync(join(penDir, file), 'utf8'))
    nodes.forEach((node, index) => {
      if (!node.id) return
      defs[node.id] = { id: node.id, name: node.name, board: basename(file, '.html'), props: styleProps(node.style), names: descendantNames(nodes, index) }
    })
  }
  return defs
}

/** (d) 板の中の部品の写し（同じ名前の節）を部品と比べる。見た目の値・中の作りの違いだけを数える。 */
export function comparePenInstances(pattern, board, nodes, defs, glob) {
  const out = { uses: 0, hits: [] }
  const owners = (pattern.owner?.pen ?? []).map((o) => defs[o.id]).filter(Boolean)
  if (!owners.length) return out
  const byName = new Map(owners.map((d) => [d.name, d]))
  nodes.forEach((node, index) => {
    const def = byName.get(node.name)
    if (!def) return
    if (pattern._pen.ancestorNot.some((re) => node.ancestors.some((name) => re.test(name)))) return
    out.uses += 1
    const props = styleProps(node.style)
    const changed = glob.penCompare.filter((prop) => (props[prop] ?? '') !== (def.props[prop] ?? ''))
    const extra = [...descendantNames(nodes, index)].filter((name) => !def.names.has(name))
    if (changed.length) out.hits.push({ board, kind: 'pen:look', component: def.id, name: node.name, detail: changed.map((p) => `${p}: ${props[p] ?? '—'} ≠ ${def.props[p] ?? '—'}`).join(' / ').slice(0, 200) })
    if (extra.length) out.hits.push({ board, kind: 'pen:detached', component: def.id, name: node.name, detail: `部品に無い中身：${extra.slice(0, 6).join('・')}`.slice(0, 200) })
  })
  return out
}

export function scanPenBoard(pattern, board, nodes) {
  const p = pattern._pen
  if (p.excludeBoards.some((re) => re.test(board))) return []
  const hits = []
  for (const node of nodes) {
    if (p.ancestorNot.some((re) => node.ancestors.some((name) => re.test(name)))) continue
    for (const marker of p.markers) {
      if (marker._name && !marker._name.test(node.name)) continue
      if (marker._nameNot && marker._nameNot.test(node.name)) continue
      if (!marker._style.every((re) => re.test(node.style))) continue
      if (marker._styleNot.some((re) => re.test(node.style))) continue
      if (marker._text && !marker._text.test(node.text)) continue
      if (marker._textNot && marker._textNot.test(node.text)) continue
      if (marker._ancestor && !node.ancestors.some((name) => marker._ancestor.test(name))) continue
      hits.push({ board, kind: 'pen:hand', marker: marker.id, why: marker.why, name: node.name, text: node.text.slice(0, 80) })
      break
    }
  }
  return hits
}

export function scanPen(catalog, penDir, patterns = catalog.patterns) {
  const glob = catalog._global
  const hand = Object.fromEntries(patterns.map((p) => [p.id, []]))
  const inst = Object.fromEntries(patterns.map((p) => [p.id, []]))
  const reach = Object.fromEntries(patterns.map((p) => [p.id, { boards: 0, uses: 0 }]))
  const titles = {}
  if (!penDir || !existsSync(penDir)) return { boards: 0, hand, inst, reach, titles, defs: {} }
  const defs = loadPenComponents(penDir)
  const files = readdirSync(penDir).filter((f) => f.endsWith('.html')).sort()
  let boards = 0
  for (const file of files) {
    const board = basename(file, '.html')
    const nodes = penNodes(readFileSync(join(penDir, file), 'utf8'))
    titles[board] = nodes[0]?.name ?? ''
    if (glob.penExcludeBoards.some((re) => re.test(board))) continue
    boards += 1
    for (const pattern of patterns) {
      hand[pattern.id].push(...scanPenBoard(pattern, board, nodes))
      const compared = comparePenInstances(pattern, board, nodes, defs, glob)
      inst[pattern.id].push(...compared.hits)
      if (compared.uses) { reach[pattern.id].boards += 1; reach[pattern.id].uses += compared.uses }
    }
  }
  return { boards, hand, inst, reach, titles, defs }
}

function countBy(list, key) {
  const out = {}
  for (const item of list) out[item[key]] = (out[item[key]] ?? 0) + 1
  return out
}

/** 持ち主が決まっているか（コードの部品と Pen の部品の両方があるか）。 */
export function ownerStatus(pattern, defs = null) {
  const code = pattern.owner?.code ?? {}
  const pen = pattern.owner?.pen ?? []
  const missing = []
  if (!(code.files ?? []).length) missing.push('コード')
  if (!pen.length) missing.push('Pen')
  const notExported = defs ? pen.filter((o) => !defs[o.id]).map((o) => o.id) : []
  return { decided: missing.length === 0, missing, notExported, note: pattern.owner?.status ?? '' }
}

export function summarize(catalog, code, pen) {
  return catalog.patterns.map((pattern) => {
    const a = code.a?.[pattern.id] ?? []
    const b = code.b?.[pattern.id] ?? []
    const c = code.c?.[pattern.id] ?? []
    const hand = pen.hand?.[pattern.id] ?? []
    const inst = pen.inst?.[pattern.id] ?? []
    const nonOwner = a.filter((h) => !isOwnerSide(h.scope))
    return {
      id: pattern.id,
      name: pattern.name,
      owner: ownerStatus(pattern, pen.defs && Object.keys(pen.defs).length ? pen.defs : null),
      a: { total: nonOwner.length, all: a.length, byScope: countBy(a, 'scope'), files: new Set(nonOwner.map((h) => h.file)).size, bySignal: countBy(a, 'signal') },
      b: { total: b.length, byKind: countBy(b, 'kind'), files: new Set(b.map((h) => h.file)).size },
      c: { total: c.length, byKind: countBy(c, 'kind'), files: new Set(c.map((h) => h.file)).size },
      d: { hand: hand.length, handBoards: new Set(hand.map((h) => h.board)).size, instance: inst.length, instanceBoards: new Set(inst.map((h) => h.board)).size, byKind: countBy(inst, 'kind') },
      reach: { codeFiles: code.reach?.[pattern.id]?.files ?? 0, codeFeatures: code.reach?.[pattern.id]?.features ?? 0, penBoards: pen.reach?.[pattern.id]?.boards ?? 0, penUses: pen.reach?.[pattern.id]?.uses ?? 0 },
    }
  })
}

function mdEscape(s) {
  return String(s).replace(/\|/g, '\\|').replace(/`/g, "'")
}

function listHits(out, hits, top, fmt) {
  for (const hit of hits.slice(0, top)) out.push(`  - ${fmt(hit)}`)
  if (hits.length > top) out.push(`  - …ほか ${hits.length - top} 件（JSON に全部）`)
}

const byPlace = (a, b) => (a.scope === 'v8' ? 0 : 1) - (b.scope === 'v8' ? 0 : 1) || a.file.localeCompare(b.file) || a.line - b.line

export function renderMarkdown({ catalog, summary, code, pen, meta, top = 15 }) {
  const out = []
  const total = (k) => summary.reduce((s, r) => s + r[k].total, 0)
  const noTypeB = code.b?.[NO_TYPE]?.length ?? 0
  const noTypeC = code.c?.[NO_TYPE]?.length ?? 0
  out.push('# 型の対応表の点検（v8-pattern-audit）', '')
  out.push(`- 作成：${meta.at}（表 ${meta.catalog}）`)
  out.push(`- コード：${meta.code}（${code.files} ファイル）／ Pen：${meta.pen}（${pen.boards} 板・部品の板は除く）`)
  out.push('- 数は「候補」。理由のある例外も混ざるので、直す前に目で確かめる。')
  out.push('- (a) 手書き＝持ち主以外で同じ形（共通部品・型の中の当たりは除いた数）／(b) 上書き＝部品に className・style を渡す・画面の CSS で部品の中を塗り直す／(c) 直書き＝画面の CSS の色・大きさ・角丸・影／(d) Pen＝板の手描きの目印・部品の写しの見た目の上書きと切り離し')
  out.push('- 効く範囲＝持ち主を直すと変わる所（コードは持ち主の部品を読む画面側のファイル数・機能の数、Pen は部品の写しを置いた板の数）', '')
  out.push(`合計：(a) ${total('a')}・(b) ${summary.reduce((s, r) => s + r.b.total, 0) + noTypeB}（型なし ${noTypeB}）・(c) ${summary.reduce((s, r) => s + r.c.total, 0) + noTypeC}（型なし ${noTypeC}）・(d) 手描き ${summary.reduce((s, r) => s + r.d.hand, 0)}／写しの上書き・切り離し ${summary.reduce((s, r) => s + r.d.instance, 0)}`, '')
  out.push('| 型 | 持ち主 | (a) 手書き（v8） | (b) 上書き | (c) 直書き | (d) Pen 手描き（板） | (d) Pen 写しの上書き（板） | 効く範囲：コード ファイル／機能 | 効く範囲：Pen 板 |', '|---|---|---|---|---|---|---|---|---|')
  for (const row of summary) {
    const owner = row.owner.decided ? '決まっている' : `未定：${row.owner.missing.join('・')}`
    out.push(`| ${row.id} ${row.name} | ${owner} | ${row.a.total}（${row.a.byScope.v8 ?? 0}） | ${row.b.total} | ${row.c.total} | ${row.d.hand}（${row.d.handBoards}） | ${row.d.instance}（${row.d.instanceBoards}） | ${row.reach.codeFiles}／${row.reach.codeFeatures} | ${row.reach.penBoards} |`)
  }
  out.push(`| ${NO_TYPE} | — | — | ${noTypeB} | ${noTypeC} | — | — | — | — |`, '')
  const undecided = summary.filter((r) => !r.owner.decided)
  out.push('## 持ち主が決まっていない型', '')
  if (!undecided.length) out.push('- なし')
  for (const row of undecided) out.push(`- ${row.id} ${row.name}：${row.owner.missing.join('・')}が無い${row.owner.note ? `（${row.owner.note}）` : ''}`)
  const notExported = summary.filter((r) => r.owner.notExported.length)
  if (notExported.length) {
    out.push('', '持ち主の Pen 部品が部品の板の html に書き出されていない（(d) の写しの比べができない）：')
    for (const row of notExported) out.push(`- ${row.id}：${row.owner.notExported.join('・')}`)
  }
  out.push('')
  for (const pattern of catalog.patterns) {
    const row = summary.find((r) => r.id === pattern.id)
    const a = [...(code.a?.[pattern.id] ?? [])].filter((h) => !isOwnerSide(h.scope)).sort(byPlace)
    const b = [...(code.b?.[pattern.id] ?? [])].sort(byPlace)
    const c = [...(code.c?.[pattern.id] ?? [])].sort(byPlace)
    const hand = pen.hand?.[pattern.id] ?? []
    const inst = pen.inst?.[pattern.id] ?? []
    out.push(`## ${pattern.id} ${pattern.name}`, '')
    out.push(`- 持ち主（コード）：${(pattern.owner?.code?.files ?? []).map((f) => `\`${f}\``).join('・') || '未定'}${(pattern.owner?.code?.vars ?? []).length ? `／変数 ${pattern.owner.code.vars.map((v) => `\`${v}\``).join('・')}` : ''}`)
    out.push(`- 持ち主（Pen）：${(pattern.owner?.pen ?? []).map((o) => `${o.id}「${o.name}」`).join('・') || '未定'}`)
    out.push(`- 効く範囲：コード ${row.reach.codeFiles} ファイル・${row.reach.codeFeatures} 機能／Pen ${row.reach.penBoards} 板（${row.reach.penUses} か所）`)
    out.push(`- (a) 目印ごと：${Object.entries(row.a.bySignal).map(([k, v]) => `${k} ${v}`).join('・') || 'なし'}`)
    out.push(`- (b) ${row.b.total}：${Object.entries(row.b.byKind).map(([k, v]) => `${k} ${v}`).join('・') || 'なし'}／(c) ${row.c.total}：${Object.entries(row.c.byKind).map(([k, v]) => `${k} ${v}`).join('・') || 'なし'}`)
    out.push(`- (d) 手描き ${row.d.hand}（${row.d.handBoards} 板）／写し ${row.d.instance}（${Object.entries(row.d.byKind).map(([k, v]) => `${k} ${v}`).join('・') || 'なし'}）`, '')
    if (a.length) { out.push('  (a)'); listHits(out, a, top, (h) => `\`${h.file}:${h.line}\` [${h.scope}/${h.signal}] ${mdEscape(h.text)}`) }
    if (b.length) { out.push('  (b)'); listHits(out, b, Math.min(top, 8), (h) => `\`${h.file}:${h.line}\` [${h.kind}] ${mdEscape(h.text)}`) }
    if (c.length) { out.push('  (c)'); listHits(out, c, Math.min(top, 8), (h) => `\`${h.file}:${h.line}\` [${h.kind}] ${mdEscape(h.text)}`) }
    const boards = Object.entries(countBy(hand, 'board')).sort((x, y) => y[1] - x[1])
    if (boards.length) out.push(`  (d) 手描き：${boards.slice(0, top).map(([bd, n]) => `${bd}（${n}）`).join('・')}${boards.length > top ? ` …ほか ${boards.length - top} 板` : ''}`)
    if (inst.length) { out.push('  (d) 写し'); listHits(out, inst, Math.min(top, 8), (h) => `${h.board} [${h.kind}] ${mdEscape(h.name)}：${mdEscape(h.detail)}`) }
    out.push('')
  }
  for (const [label, list] of [['(b) 型なしの上書き', code.b?.[NO_TYPE] ?? []], ['(c) 型なしの直書き', code.c?.[NO_TYPE] ?? []]]) {
    out.push(`## ${label}（${list.length}）`, '')
    const files = Object.entries(countBy(list, 'file')).sort((x, y) => y[1] - x[1])
    out.push(...files.slice(0, 25).map(([f, n]) => `- \`${f}\` ${n}`))
    if (files.length > 25) out.push(`- …ほか ${files.length - 25} ファイル`)
    out.push('')
  }
  return out.join('\n')
}

export function parseArgs(argv) {
  const args = { top: 15 }
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    const value = argv[i + 1]
    if (key === '--code') { args.code = value; i += 1 }
    else if (key === '--pen') { args.pen = value; i += 1 }
    else if (key === '--out') { args.out = value; i += 1 }
    else if (key === '--catalog') { args.catalog = value; i += 1 }
    else if (key === '--only') { args.only = value.split(','); i += 1 }
    else if (key === '--top') { args.top = Number(value); i += 1 }
    else if (key === '--help' || key === '-h') args.help = true
    else throw new Error(`知らない引数：${key}`)
  }
  return args
}

export function run(args) {
  const catalog = loadCatalog(expandHome(args.catalog) ?? DEFAULT_CATALOG)
  const patterns = args.only ? catalog.patterns.filter((p) => args.only.includes(p.id)) : catalog.patterns
  const codeRoot = args.code ? resolve(expandHome(args.code)) : null
  const penDir = args.pen ? resolve(expandHome(args.pen)) : null
  const code = codeRoot ? scanCode(catalog, codeRoot, patterns) : { files: 0, a: {}, b: {}, c: {}, reach: {} }
  const pen = penDir ? scanPen(catalog, penDir, patterns) : { boards: 0, hand: {}, inst: {}, reach: {}, titles: {}, defs: {} }
  const view = { ...catalog, patterns }
  const summary = summarize(view, code, pen)
  const meta = { at: new Date().toISOString(), code: codeRoot ?? '—', pen: penDir ?? '—', catalog: catalog.version }
  return { catalog: view, summary, code, pen, meta }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || (!args.code && !args.pen)) {
    console.log('使い方: node scripts/visual-qa/v8-pattern-audit.mjs --code <リポジトリの根> --pen <板の html のフォルダ> --out <出力先> [--only id,id] [--top 15]')
    process.exit(args.help ? 0 : 2)
  }
  const report = run(args)
  const out = resolve(expandHome(args.out ?? 'pattern-audit-run'))
  mkdirSync(out, { recursive: true })
  const json = {
    meta: report.meta,
    summary: report.summary,
    a: report.code.a,
    b: report.code.b,
    c: report.code.c,
    penHand: report.pen.hand,
    penInstance: report.pen.inst,
    penTitles: report.pen.titles,
  }
  writeFileSync(join(out, 'pattern-audit.json'), `${JSON.stringify(json, null, 2)}\n`)
  writeFileSync(join(out, 'pattern-audit.md'), `${renderMarkdown({ ...report, top: args.top })}\n`)
  for (const row of report.summary) {
    console.log(`${row.id.padEnd(16)} a ${String(row.a.total).padStart(4)} b ${String(row.b.total).padStart(4)} c ${String(row.c.total).padStart(5)} d ${String(row.d.hand).padStart(4)}/${String(row.d.instance).padStart(4)}  効く ${row.reach.codeFiles}f/${row.reach.penBoards}板  ${row.owner.decided ? '' : `未定:${row.owner.missing.join('・')}`}`)
  }
  console.log(`(型なし) b ${report.code.b?.[NO_TYPE]?.length ?? 0} c ${report.code.c?.[NO_TYPE]?.length ?? 0}`)
  console.log(`→ ${join(out, 'pattern-audit.md')}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
