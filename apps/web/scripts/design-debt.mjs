/** 現在の宣言数を報告する。表示制御が部品に効かない場合だけ止める。 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
export const SRC = join(WEB, 'src')
const PARTS = join(WEB, 'design', 'design-parts.json')

/**
 * 表示制御のクラスかどうか。部品側が `display` を持つので、渡されても効かない。
 *
 * 前置き（`md:` `dark:` `peer-checked:` `data-[open]:` …）は列挙しない。
 * 列挙すると `md:max-lg:hidden` のような重ねがけや、新しい前置きを見逃す。
 * **最後のコロンより後ろ**だけを見る。
 */
const DISPLAY_BASE = new Set([
  'hidden', 'block', 'inline', 'inline-block', 'inline-flex', 'flex',
  'grid', 'inline-grid', 'contents', 'table', 'flow-root', 'list-item',
])

export function isDisplayClass(className) {
  // 前置きを落として基底だけにし、重要度の印を外す。
  // 印は Tailwind v3 が先頭（`!hidden`）、v4 が末尾（`hidden!`）で、
  // 前置きの後ろに付く形（`md:flex!`）もある。両方に対応する。
  const base = className.split(':').pop()?.replace(/^!|!$/g, '')
  return DISPLAY_BASE.has(base)
}

/** 共通部品のファイルの絶対パス。 */
export function partFiles(data = JSON.parse(readFileSync(PARTS, 'utf8'))) {
  const files = new Set()
  for (const [key, part] of Object.entries(data.parts)) {
    if (key.startsWith('$')) continue
    if (part.code) files.add(join(WEB, part.code))
    for (const implementationFile of part.implementationFiles ?? []) {
      files.add(join(WEB, implementationFile))
    }
  }
  // 持ち主が決まった共通部品と、画素照合が済んだ値の契約は別。
  // 照合待ちでも登録された共通部品自身を画面の手書きとして数えない。
  for (const part of Object.values(data.investigations ?? {})) {
    if (part.role === 'canonical' && part.status === 'active'
      && part.code?.startsWith('src/components/shared/') && part.components?.length) {
      files.add(join(WEB, part.code))
    }
  }
  return files
}

/** import の行き先を実在するファイルへ直す。 */
function resolveImport(fromFile, spec) {
  let base
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else return null
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/**
 * そのファイルの中で共通部品を指している**ローカル名**を集める。
 *
 * 名前を決め打ちにすると `import Button as SharedButton` や、
 * default import に好きな名前を付けるだけで検査をすり抜けられる。
 * import の行き先で判断する。
 */
function localPartNames(file, source, parts) {
  const names = new Set()
  const walk = (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const target = resolveImport(file, n.moduleSpecifier.text)
      if (target && parts.has(target)) {
        const clause = n.importClause
        // `import Button from '...'` / `import 好きな名前 from '...'`
        if (clause?.name) names.add(clause.name.getText())
        const bindings = clause?.namedBindings
        if (bindings) {
          // `import * as X from '...'` → `<X.Th>` の形で使われる
          if (ts.isNamespaceImport(bindings)) names.add(`${bindings.name.getText()}.`)
          // `import { Th, TableHeadRow as Row } from '...'`
          else if (ts.isNamedImports(bindings)) {
            for (const el of bindings.elements) names.add(el.name.getText())
          }
        }
      }
    }
    ts.forEachChild(n, walk)
  }
  walk(source)
  return names
}

export function sourceFiles(dir = SRC) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    // 試験は画面に出ない。説明のためにクラス名を書くことがある。
    else if (/\.test\.tsx?$/.test(name)) continue
    else if (name.endsWith('.tsx')) out.push(full)
  }
  return out.sort()
}

/**
 * `className` の中身から、静的に読めるクラス名をすべて集める。
 * 読めない部分があったときは `unresolved` を立てる。
 */
function readClassName(node, cssModules = new Map(), staticBindings = new Map()) {
  const classes = []
  let unresolved = false

  const visit = (n) => {
    if (!n || n.kind === ts.SyntaxKind.NullKeyword || n.kind === ts.SyntaxKind.FalseKeyword
      || (ts.isIdentifier(n) && n.text === 'undefined')) return
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      classes.push(...n.text.split(/\s+/).filter(Boolean))
      return
    }
    if (ts.isTemplateExpression(n)) {
      classes.push(...n.head.text.split(/\s+/).filter(Boolean))
      for (const span of n.templateSpans) {
        visit(span.expression)
        classes.push(...span.literal.text.split(/\s+/).filter(Boolean))
      }
      return
    }
    if (ts.isConditionalExpression(n)) {
      visit(n.whenTrue)
      visit(n.whenFalse)
      return
    }
    if (ts.isBinaryExpression(n)) {
      visit(n.left)
      visit(n.right)
      return
    }
    if (ts.isParenthesizedExpression(n)) return visit(n.expression)
    if (ts.isJsxExpression(n)) return visit(n.expression)
    if (ts.isArrayLiteralExpression(n)) return n.elements.forEach(visit)
    if (ts.isCallExpression(n)) {
      // clsx(...) のような組み立ては引数を見る。関数そのものは追えない。
      n.arguments.forEach(visit)
      unresolved = true
      return
    }
    // CSS Modules の実在する札は静的に解決できる。存在しない札や変数は
    // 引き続き未解決として数え、Tailwind の動的組み立ても除外しない。
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression)
      && cssModules.get(n.expression.text)?.has(n.name.text)) return
    if (ts.isElementAccessExpression(n) && ts.isIdentifier(n.expression)
      && n.argumentExpression && ts.isStringLiteral(n.argumentExpression)
      && cssModules.get(n.expression.text)?.has(n.argumentExpression.text)) return
    if (ts.isIdentifier(n) && staticBindings.has(n.text)) {
      visit(staticBindings.get(n.text))
      return
    }
    if (ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) {
      unresolved = true
      return
    }
    unresolved = true
  }

  visit(node)
  return { classes, unresolved }
}

/**
 * 1ファイルぶんを数える。`parts` は共通部品のファイルの絶対パスの集合。
 *
 * 試験から合成したソースを渡せるように切り出してある。
 */
const staticExportCache = new Map()

export function analyzeSource(full, text, parts) {
  const counts = {}
  const bump = (_file, key) => {
    counts[key] = (counts[key] ?? 0) + 1
  }
  {
    const file = null
    const source = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    // 名前ではなく import の行き先で共通部品を見分ける。
    const partNames = localPartNames(full, source, parts)
    const cssModules = new Map()
    const staticBindings = new Map()
    // 共有されている文字列定数だけを解決する。入力や関数の結果は追わない。
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
        || !statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue
      const target = resolveImport(full, statement.moduleSpecifier.text)
      if (!target || !/\.tsx?$/.test(target)) continue
      let imported = staticExportCache.get(target)
      if (!imported) {
        imported = ts.createSourceFile(target, readFileSync(target, 'utf8'), ts.ScriptTarget.Latest, true)
        staticExportCache.set(target, imported)
      }
      for (const declaration of imported.statements) {
        if (!ts.isVariableStatement(declaration) || !(declaration.declarationList.flags & ts.NodeFlags.Const)
          || !declaration.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
        for (const binding of declaration.declarationList.declarations) {
          if (!ts.isIdentifier(binding.name) || !binding.initializer
            || !(ts.isStringLiteral(binding.initializer) || ts.isNoSubstitutionTemplateLiteral(binding.initializer))) continue
          for (const specifier of statement.importClause.namedBindings.elements) {
            if ((specifier.propertyName ?? specifier.name).text === binding.name.text)
              staticBindings.set(specifier.name.text, binding.initializer)
          }
        }
      }
    }
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
        || !statement.moduleSpecifier.text.endsWith('.module.css') || !statement.importClause?.name) continue
      const target = resolveImport(full, statement.moduleSpecifier.text)
      if (!target) continue
      const css = readFileSync(target, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      const names = new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]))
      cssModules.set(statement.importClause.name.text, names)
    }

    const walk = (node) => {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const tag = node.tagName.getText()
        const attr = node.attributes.properties.find(
          (p) => ts.isJsxAttribute(p) && p.name.getText() === 'className',
        )
        const read = attr?.initializer ? readClassName(attr.initializer, cssModules, staticBindings) : { classes: [], unresolved: false }

        // 静的に読めない className。数に入らないぶん、別の指標として数える。
        if (read.unresolved) bump(file, 'unresolved-classname')

        // 直書きの表見出し。共通部品の `<Th>` は大文字なので当たらない。
        if (tag === 'th') bump(file, 'direct-th')

        if (read.classes.length) {
          for (const c of read.classes) {
            // Tailwind の任意値記法。規格から外れた値が普通のクラスに見える。
            if (c.includes('[')) bump(file, 'arbitrary-value')
          }
          const isControl = tag === 'button' || tag === 'Link' || tag === 'a'
          /*
            主ボタンの地は 2 つある。**`bg-accent` だけを数えていると、
            白文字が乗る側（`bg-accent-deep`）が数から消える。**
            2026-09-04 に白文字が乗る 138 か所を deep へ寄せたとき、
            この数が 130 → 11 に落ちて気づいた。借金が減ったのではない。
          */
          if (isControl && (read.classes.includes('bg-accent') || read.classes.includes('bg-accent-deep')))
            bump(file, 'direct-primary-button')
          if (isControl && read.classes.includes('border-hairline')) bump(file, 'direct-secondary-button')

          // 共通部品へ表示制御を渡してはいけない。部品のCSSはレイヤーに
          // 属さないので Tailwind のユーティリティにつねに勝ち、黙って効かない。
          // 表示を切り替えるときは HTML の `hidden` 属性を使う
          // （Tailwind base の `[hidden]{display:none!important}` が効く）。
          const isPart =
            partNames.has(tag) || [...partNames].some((n) => n.endsWith('.') && tag.startsWith(n))
          if (isPart) {
            for (const c of read.classes) {
              if (isDisplayClass(c)) bump(file, 'display-class-on-part')
            }
          }
        }
      }
      ts.forEachChild(node, walk)
    }
    walk(source)
  }
  return counts
}

export function countDebt() {
  const parts = partFiles()
  const counts = {}
  for (const full of sourceFiles()) {
    // 正本の部品実装には、button/thなどのネイティブ要素とCSS Moduleを
    // 組み立てるclassNameが必要。ここを直書き負債へ数えると、部品を追加した
    // だけで基準値を緩めることになる。検査対象は部品を使う側の画面に限定する。
    if (parts.has(full)) continue
    const perFile = analyzeSource(full, readFileSync(full, 'utf8'), parts)
    if (Object.keys(perFile).length) counts[relative(SRC, full)] = perFile
  }
  return { counts }
}

/** 合計を種類ごとに出す。 */
export function totals(counts) {
  const sum = {}
  for (const perFile of Object.values(counts)) {
    for (const [k, n] of Object.entries(perFile)) sum[k] = (sum[k] ?? 0) + n
  }
  return sum
}

/** 常に0でなければならない種類。 */
export const ZERO_TOLERANCE = ['display-class-on-part']

if (process.argv[1] && process.argv[1].endsWith('design-debt.mjs')) {
  const { counts } = countDebt(), sum = totals(counts)
  console.log(JSON.stringify({ counts, totals: sum }, null, 2))
  const hiddenControls = ZERO_TOLERANCE.some(key => (sum[key] ?? 0) > 0)
  if (hiddenControls) process.exitCode = 1
}
