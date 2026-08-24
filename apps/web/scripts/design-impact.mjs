/*
 * 基準を変える**前**に、どこまで影響するかを出す。
 *
 *   node apps/web/scripts/design-impact.mjs --token --color-hairline
 *   node apps/web/scripts/design-impact.mjs --part summary-card
 *   node apps/web/scripts/design-impact.mjs --part XywGr
 *
 * 出すもの:
 *
 *   1. 変更対象（Pencilでの使用回数、コードのパス）
 *   2. 参照しているファイルと、そこから辿れるルート
 *   3. 共通部品を通らず直接値を書いている箇所（この変更では直らない）
 *   4. 撮り直す基準画面
 *   5. **追跡できなかったもの**（動的import・再export・深さ上限）
 *
 * 5 を必ず出すのが要点。黙って対象外にすると、
 * 「影響が無い」と「調べられなかった」の区別がつかなくなる。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { countDebt } from './design-debt.mjs'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(WEB, 'src')
const PARTS = join(WEB, 'design', 'design-parts.json')
const MAX_DEPTH = 12

const UTILITY =
  'bg|text|border|ring|divide|outline|decoration|fill|stroke|placeholder|caret|from|to|via|rounded|shadow'

export function allFiles(dir = SRC) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...allFiles(full))
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out.sort()
}

/** ファイルが import しているローカルファイルを返す。追えないものは印を付ける。 */
function importsOf(file) {
  const text = readFileSync(file, 'utf8')
  const local = []
  const notes = []

  if (!file.endsWith('.css')) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const add = (spec) => {
      if (!spec) return
      if (spec.startsWith('@/')) local.push(join(SRC, spec.slice(2)))
      else if (spec.startsWith('.')) local.push(resolve(dirname(file), spec))
    }
    const walk = (n) => {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) add(n.moduleSpecifier.text)
      else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
        add(n.moduleSpecifier.text)
        // `export * from` は名前が辿れないので印を付ける。
        if (!n.exportClause) notes.push(`再export: ${relative(SRC, file)} → ${n.moduleSpecifier.text}`)
      } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = n.arguments[0]
        if (arg && ts.isStringLiteral(arg)) add(arg.text)
        else notes.push(`動的import（行き先が定数でない）: ${relative(SRC, file)}`)
      }
      ts.forEachChild(n, walk)
    }
    walk(source)
  }
  return { local, notes }
}

/** 拡張子を補って実在するパスにする。 */
function resolveFile(base) {
  const candidates = [
    base,
    `${base}.tsx`, `${base}.ts`, `${base}.css`,
    join(base, 'index.tsx'), join(base, 'index.ts'),
  ]
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null
}

/** 名前ではなくimport先が対象ファイルと一致するファイルだけを返す。 */
export function directImporters(files, targetFile) {
  if (!targetFile) return []
  return files.filter((file) =>
    importsOf(file).local.some((spec) => resolveFile(spec) === targetFile),
  )
}

function routeOf(file) {
  const rel = relative(join(SRC, 'app'), file)
  if (rel.startsWith('..')) return null
  if (!/(^|\/)page\.tsx$/.test(rel)) return null
  const route = `/${rel.replace(/(^|\/)page\.tsx$/, '')}`.replace(/\/+$/, '')
  return route === '' ? '/' : route
}

function main() {
  // `pnpm --filter web design:impact -- --token X` の形で渡されると、
  // 先頭に余分な `--` が残ることがある。どちらの書き方でも動くようにする。
  const args = process.argv.slice(2).filter((a) => a !== '--')
  const kind = args[0]
  const target = args[1]
  const data = JSON.parse(readFileSync(PARTS, 'utf8'))

  if (!['--token', '--part'].includes(kind) || !target) {
    console.log('使い方:')
    console.log('  pnpm --filter web design:impact --token --color-hairline')
    console.log('  pnpm --filter web design:impact --part summary-card')
    console.log('  node apps/web/scripts/design-impact.mjs --part XywGr')
    process.exit(2)
  }

  /* --- 何を探すか決める --- */
  let title, meta, patterns, partFile, searchDescription
  if (kind === '--token') {
    const t = data.tokens[target]
    if (!t) { console.log(`design-parts.json に ${target} がありません。`); process.exit(2) }
    const bare = target.replace(/^--(color|radius|text|shadow)-/, '')
    const utilityName =
      target.startsWith('--radius-') ? `rounded-${bare}`
      : target.startsWith('--text-') ? `text-${bare}`
      : target.startsWith('--shadow-') ? `shadow-${bare}`
      : null
    patterns = [
      new RegExp(`var\\(\\s*${target}\\s*\\)`),
      utilityName ? new RegExp(`\\b${utilityName}\\b`) : new RegExp(`\\b(?:${UTILITY})-${bare}\\b`),
    ]
    searchDescription = patterns.map((p) => p.source).join('  ')
    title = `トークン ${target}`
    meta = [`Pencil     ${t.pencil} = ${t.resolved}`, `状態       ${t.status}`, t.note ? `覚え書き   ${t.note}` : null]
  } else {
    const [key, part] =
      Object.entries(data.parts).find(([k, p]) => k === target || (p.pencilNodes ?? []).includes(target)) ?? []
    if (!part) { console.log(`design-parts.json の parts に ${target} がありません。`); process.exit(2) }
    patterns = []
    partFile = resolveFile(join(WEB, part.code))
    searchDescription = `import先が ${part.code} と一致`
    title = `部品 ${part.name}（${part.pencilNodes.join(' / ')}）`
    meta = [
      `Pencilでの使用回数  ${part.pencilUsage} 回`,
      `コード              ${part.code}`,
      `状態                ${part.status} / ${part.role} / ${part.reviewStatus}`,
    ]
  }

  /* --- 参照しているファイル --- */
  const files = allFiles()
  const hits =
    kind === '--part'
      ? directImporters(files, partFile)
      : files.filter((f) => {
          const text = readFileSync(f, 'utf8')
          return patterns.some((p) => p.test(text))
        })
  // 部品は実装ファイルそのものを到達点にする。同名のローカル部品や
  // `button.tsx` のような一般的なファイル名を参照扱いしない。
  const hitSet = new Set(kind === '--part' ? (partFile ? [partFile] : []) : hits)

  /* --- import の地図を先に作る ---
   * 探索の途中で作ると、ルートが早く当たって打ち切られたとき、
   * その先の「追跡できないもの」を数え損ねる。全ファイルを1回ずつ読む。
   */
  const notes = new Set()
  const graph = new Map()

  for (const file of files) {
    const { local, notes: n } = importsOf(file)
    for (const x of n) notes.add(x)
    const edges = []
    for (const spec of local) {
      const resolved = resolveFile(spec)
      if (resolved) edges.push(resolved)
      else notes.add(`行き先が見つからない import: ${relative(SRC, file)} → ${relative(SRC, spec)}`)
    }
    graph.set(file, edges)
  }

  /* --- ルートを辿る --- */
  const reached = new Set()
  let depthHit = 0

  for (const file of files) {
    const route = routeOf(file)
    if (!route) continue
    const seen = new Set()
    const stack = [[file, 0]]
    while (stack.length) {
      const [current, depth] = stack.pop()
      if (seen.has(current)) continue
      seen.add(current)
      if (hitSet.has(current)) { reached.add(route); break }
      if (depth >= MAX_DEPTH) { depthHit++; notes.add(`深さ上限(${MAX_DEPTH})で打ち切り: ${route}`); continue }
      for (const next of graph.get(current) ?? []) stack.push([next, depth + 1])
    }
  }

  /* --- 直書きの残り --- */
  const { counts } = countDebt()
  const debt = {}
  for (const perFile of Object.values(counts)) {
    for (const [k, n] of Object.entries(perFile)) debt[k] = (debt[k] ?? 0) + n
  }

  /* --- 出力 --- */
  console.log(`影響レポート: ${title}\n`)
  for (const line of meta.filter(Boolean)) console.log(`  ${line}`)
  console.log(`\n  探した書き方  ${searchDescription}`)
  console.log(`\n  参照しているファイル ${hits.length} / 到達するルート ${reached.size}`)
  for (const r of [...reached].sort().slice(0, 20)) console.log(`    ${r}`)
  if (reached.size > 20) console.log(`    …ほか ${reached.size - 20} ルート`)

  console.log('\n  共通部品を通らない直書き（この変更では直らない）')
  for (const [k, n] of Object.entries(debt).sort()) console.log(`    ${k.padEnd(26)}${String(n).padStart(5)} か所`)

  console.log('\n  撮り直す基準画面')
  for (const [route, why] of Object.entries(data.baselineScreens)) {
    if (route.startsWith('$')) continue
    const mark = reached.has(route) ? '●' : '○'
    console.log(`    ${mark} ${route.padEnd(14)}${why}`)
  }
  console.log('    ● は今回の変更が届くルート')

  console.log(`\n  未解決 ${notes.size} 件（追跡できなかったもの。影響が無いという意味ではない）`)
  for (const n of [...notes].slice(0, 15)) console.log(`    ${n}`)
  if (notes.size > 15) console.log(`    …ほか ${notes.size - 15} 件`)
  if (depthHit) console.log(`    深さ上限に当たったルート: ${depthHit}`)
}

if (process.argv[1] && process.argv[1].endsWith('design-impact.mjs')) main()
