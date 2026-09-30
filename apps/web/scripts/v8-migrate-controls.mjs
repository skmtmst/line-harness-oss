/*
 * V8 移行 ①: 直書きの button/a/th を共通部品（Button / Th）へ置き換える。
 *
 *   node apps/web/scripts/v8-migrate-controls.mjs           ドライラン（一覧だけ）
 *   node apps/web/scripts/v8-migrate-controls.mjs --apply   書き換える
 *
 * 方針（①は「見た目を変えない」）:
 * - 見た目に効くクラスは全部残す。部品が同じ値で持っているもの
 *   （bg-accent-deep・text-on-accent・rounded-control・cursor-pointer 等）だけ落とす。
 * - display クラス（hidden/table-cell 等）が付いた要素は部品へ渡せない
 *   （display-class-on-part = 0 トレランス）ので、そのまま残して skip に数える。
 * - className が式の場合はタグだけ置き換え、className は触らない。
 * - `<button>` に `type` が無く `<form>` の内側にあるものは `type="submit"` を
 *   補う（HTML の既定が submit のため、Button の既定 type="button" だと動きが変わる）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { sourceFiles } from './design-debt.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')
const SRC = join(WEB, 'src')
const APPLY = process.argv.includes('--apply')

// design-debt.mjs と同じく、共通部品の実装ファイルは除外する
// （Th の中の <th> を Th に置き換えると無限再帰になる）。
function partFiles() {
  const data = JSON.parse(readFileSync(join(WEB, 'design', 'design-parts.json'), 'utf8'))
  const files = new Set()
  for (const [key, part] of Object.entries(data.parts)) {
    if (key.startsWith('$')) continue
    if (part.code) files.add(join(WEB, part.code))
    for (const f of part.implementationFiles ?? []) files.add(join(WEB, f))
  }
  return files
}
const PART_FILES = partFiles()

const DISPLAY_BASE = new Set([
  'hidden', 'block', 'inline', 'inline-block', 'inline-flex', 'flex',
  'grid', 'inline-grid', 'contents', 'table', 'flow-root', 'list-item',
])

const DROP_PRIMARY = new Set([
  'bg-accent-deep', 'text-on-accent', 'rounded-control', 'border',
  'cursor-pointer', 'hover:brightness-92', 'disabled:cursor-not-allowed',
  'disabled:opacity-40', 'font-semibold', 'text-sm', 'transition-colors',
])
const DROP_SECONDARY = new Set([
  'border-hairline', 'bg-canvas', 'text-ink', 'rounded-control', 'border',
  'hover:bg-canvas-sunken', 'cursor-pointer', 'disabled:cursor-not-allowed',
  'disabled:opacity-40', 'font-semibold', 'text-sm', 'transition-colors',
])
const DROP_DANGER = new Set([
  'bg-danger', 'border-danger', 'text-on-accent', 'rounded-control', 'border',
  'cursor-pointer', 'hover:brightness-92', 'disabled:cursor-not-allowed',
  'disabled:opacity-40', 'font-semibold', 'text-sm', 'transition-colors',
])
const DROP_TH = new Set([
  // .cell と同値のものだけ落とす。text-xs は line-height:1rem を持ち
  // .cell（行高は継承）と一致しないので残す。
  'text-left', 'text-ink-faint', 'font-semibold', 'whitespace-nowrap',
])

const dropSetFor = (v) =>
  v === 'primary' ? DROP_PRIMARY : v === 'danger' ? DROP_DANGER : DROP_SECONDARY

// Button は inline-flex + nowrap。子が縦に積まれる構造（block/mt- の子、
// div 等のブロック要素）を持つボタンはレイアウトが崩れるので変換しない。
const STRUCTURED_TAG = /^(div|p|section|article|ul|ol|li|table|h[1-6]|dl|figure|main|header|footer|nav)$/
const STRUCTURED_CLASS = /(?:^|\s)(?:[a-z0-9-]+:)*(?:block|grid|table|mt-\d|mb-\d|my-\d|w-full|min-h-)(?:\s|$)/
function hasStructuredChildren(jsxParent) {
  if (!ts.isJsxElement(jsxParent)) return false
  for (const child of jsxParent.children) {
    if (!ts.isJsxElement(child)) continue
    const t = child.openingElement.tagName.getText()
    if (STRUCTURED_TAG.test(t)) return true
    const c = child.openingElement.attributes.properties.find(
      (p) => ts.isJsxAttribute(p) && p.name.getText() === 'className',
    )
    if (c?.initializer && STRUCTURED_CLASS.test(c.initializer.getText())) return true
  }
  return false
}

// Button の .button/.standard が持つ高さ(40px)・border(1px)が漏れないよう、
// 元のクラスに該当指定が無いときは打ち消すユーティリティを足す。
// min-h-/max-h- だけでは部品の height:40px を打ち消せないので、
// 高さの指定として数えるのは h- 系だけにする。
const HAS_HEIGHT = /^(?:[a-z0-9-]+:)*h-(?:\d|\[|auto|full|fit|screen)/
const HAS_BORDER_ALL = /^(?:[a-z0-9-]+:)*border(?:-0|-2|-4|-8|-\[|$)/
const HAS_BORDER_DIR = /^(?:[a-z0-9-]+:)*border-(?:x|y|t|r|b|l)(?:-|$)/
// Tailwind preflight は button の padding を 0 にするので、px 未指定の
// 元ボタンへ部品の padding:9px 13px が漏れないよう px-0 を足す。
const HAS_PX = /^(?:[a-z0-9-]+:)*p(?:x|l|r)?-/

/** 変換可否 + 見た目維持のために足すクラスを返す。null = skip。 */
function planButtonClasses(classes, variant) {
  const kept = classes
    .filter((c) => c !== 'inline-flex')
    .filter((c) => !dropSetFor(variant).has(c))
  const allSide = classes.some((c) => HAS_BORDER_ALL.test(c))
  const dirSide = classes.some((c) => HAS_BORDER_DIR.test(c))
  if (dirSide && !allSide) return null // 片側だけの border は部品の4辺 border と両立しない
  if (!allSide) kept.push('border-0')
  if (!classes.some((c) => HAS_HEIGHT.test(c))) kept.push('h-auto')
  if (!classes.some((c) => HAS_PX.test(c))) kept.push('px-0')
  if (!classes.some((c) => /^(?:[a-z0-9-]+:)*whitespace-/.test(c))) kept.push('whitespace-normal')
  return kept
}

/** 動的 className へ足す打ち消しクラス。 */
function buttonGuards(classes) {
  const guards = []
  if (!classes.some((c) => HAS_BORDER_ALL.test(c))) guards.push('border-0')
  if (!classes.some((c) => HAS_HEIGHT.test(c))) guards.push('h-auto')
  if (!classes.some((c) => HAS_PX.test(c))) guards.push('px-0')
  if (!classes.some((c) => /^(?:[a-z0-9-]+:)*whitespace-/.test(c))) guards.push('whitespace-normal')
  return guards
}

function detectVariant(tag, classes) {
  if (tag !== 'button' && tag !== 'a' && tag !== 'Link') return null
  if (classes.includes('bg-danger') || classes.includes('border-danger')) return 'danger'
  if (classes.includes('bg-accent') || classes.includes('bg-accent-deep')) return 'primary'
  if (classes.includes('border-hairline')) return 'secondary'
  return null
}

/** className 初期値から静的に読めるクラスを集める。式が混ざると unresolved。 */
function staticClasses(init) {
  const classes = []
  let unresolved = false
  const visit = (n) => {
    if (!n) return
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      classes.push(...n.text.split(/\s+/).filter(Boolean))
      return
    }
    if (ts.isTemplateExpression(n)) {
      classes.push(...n.head.text.split(/\s+/).filter(Boolean))
      for (const s of n.templateSpans) {
        visit(s.expression) // 条件分岐の中のクラスも検出対象（design-debt と同じ走査）
        classes.push(...s.literal.text.split(/\s+/).filter(Boolean))
        unresolved = true
      }
      return
    }
    if (ts.isConditionalExpression(n)) { visit(n.whenTrue); visit(n.whenFalse); return }
    if (ts.isBinaryExpression(n)) { visit(n.left); visit(n.right); return }
    if (ts.isParenthesizedExpression(n)) return visit(n.expression)
    if (ts.isArrayLiteralExpression(n)) return n.elements.forEach(visit)
    if (ts.isJsxExpression(n)) return visit(n.expression)
    unresolved = true
  }
  visit(init)
  return { classes, unresolved }
}

/** 先祖に <form> があるか（ボタンの既定 type が submit になる条件）。 */
function inForm(node) {
  let cur = node.parent
  while (cur) {
    if (ts.isJsxElement(cur) && cur.openingElement.tagName.getText() === 'form') return true
    if (ts.isJsxSelfClosingElement(cur) && cur.tagName.getText() === 'form') return true
    cur = cur.parent
  }
  return false
}

const report = { converted: [], skipped: [] }

for (const file of sourceFiles()) {
  if (PART_FILES.has(file)) continue
  const text = readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const rel = relative(SRC, file)
  const edits = []
  let needButtonImport = false
  let needThImport = false
  let collision = false

  // `Button`/`Th` というローカル名が既に別物を指していないか。
  const checkNames = (n) => {
    if (ts.isImportDeclaration(n)) {
      const spec = ts.isStringLiteral(n.moduleSpecifier) ? n.moduleSpecifier.text : ''
      const clause = n.importClause
      if (clause?.name && clause.name.getText() === 'Button' && spec !== '@/components/shared/button') collision = true
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          if (el.name.getText() === 'Th' && spec !== '@/components/shared/table') collision = true
        }
      }
    }
    if (ts.isFunctionDeclaration(n) && n.name?.getText() === 'Button') collision = true
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (d.name.getText() === 'Button') collision = true
      }
    }
    ts.forEachChild(n, checkNames)
  }
  checkNames(source)

  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText()
      const classAttr = node.attributes.properties.find(
        (p) => ts.isJsxAttribute(p) && p.name.getText() === 'className',
      )
      const init = classAttr?.initializer
      const initExpr = init
        ? (ts.isJsxExpression(init) ? init.expression : init)
        : undefined
      const read = initExpr ? staticClasses(initExpr) : { classes: [], unresolved: false }
      const isStaticClass = Boolean(initExpr &&
        (ts.isStringLiteral(initExpr) || ts.isNoSubstitutionTemplateLiteral(initExpr)))

      // role="switch" のトグルは標準ボタンではない（ノブの位置が flex の
      // justify-center で崩れる）ので変換しない。
      const isSwitch = node.attributes.properties.some(
        (p) =>
          ts.isJsxAttribute(p) &&
          p.name.getText() === 'role' &&
          p.initializer &&
          ts.isStringLiteral(p.initializer) &&
          p.initializer.text === 'switch',
      )
      const variant = isSwitch ? null : detectVariant(tag, read.classes)
      if (variant) {
        // inline-flex は部品と同値、hidden は属性で表せるので変換可能。
        // それ以外の display クラス（flex/grid/2xl:table-cell 等）は部品へ渡せないので skip。
        const display = read.classes.filter((c) => {
          if (!DISPLAY_BASE.has(c)) return false
          return c !== 'inline-flex' && c !== 'hidden'
        })
        const kept = display.length ? null : planButtonClasses(read.classes, variant)
        if (display.length) {
          report.skipped.push(`${rel}: <${tag}> display:${display.join(',')}`)
        } else if (!kept) {
          report.skipped.push(`${rel}: <${tag}> 片側border`)
        } else if (hasStructuredChildren(node.parent)) {
          report.skipped.push(`${rel}: <${tag}> 構造的な子要素`)
        } else {
          const hasType = node.attributes.properties.some(
            (p) => ts.isJsxAttribute(p) && p.name.getText() === 'type',
          )
          const needSubmit = tag === 'button' && !hasType && inForm(node)

          let newText = `<Button variant="${variant}"`
          if (read.classes.includes('hidden')) newText += ' hidden'
          if (isStaticClass) {
            const cls = kept.filter((c) => c !== 'hidden')
            if (cls.length) newText += ` className="${cls.join(' ')}"`
          } else if (init) {
            // 動的 className は式の末尾へガード用クラスを足して残す。
            // inline-flex は部品の既定と同じ値なので消す（display-class-on-part = 0 トレランス）。
            const guards = buttonGuards(read.classes)
            const attrText = text
              .slice(classAttr.getStart(), classAttr.getEnd())
              .replace(/\binline-flex\b ?/g, '')
            const m = attrText.match(/^className=\{(.*)\}$/s)
            newText += guards.length && m
              ? ` className={(${m[1]}) + ' ${guards.join(' ')}'}`
              : ` ${attrText}`
          }
          for (const p of node.attributes.properties) {
            if (p === classAttr) continue
            newText += ` ${text.slice(p.getStart(), p.getEnd())}`
          }
          if (needSubmit) newText += ' type="submit"'
          if (ts.isJsxSelfClosingElement(node)) {
            newText += ' />'
            edits.push({ start: node.getStart(), end: node.getEnd(), text: newText })
          } else {
            newText += '>'
            edits.push({ start: node.getStart(), end: node.getEnd(), text: newText })
            const el = node.parent
            if (ts.isJsxElement(el)) {
              edits.push({ start: el.closingElement.getStart(), end: el.closingElement.getEnd(), text: '</Button>' })
            }
          }
          needButtonImport = true
          report.converted.push(`${rel}: <${tag}> → Button[${variant}]${isStaticClass ? '' : '（className残し）'}`)
        }
      } else if (tag === 'th') {
        const isHiddenTh = read.classes.includes('hidden')
        const display = read.classes.filter((c) => {
          if (c === 'hidden') return false // hidden 属性で表せる
          return DISPLAY_BASE.has(c) || /(?:^|:)(hidden|table-cell|table|block|inline-block|inline-flex|flex|grid)$/.test(c)
        })
        if (display.length) {
          report.skipped.push(`${rel}: <th> display:${display.join(',')}`)
        } else if (isHiddenTh) {
          // hidden だけ → Th へ hidden 属性で移す
          if (ts.isJsxSelfClosingElement(node)) {
            edits.push({ start: node.getStart(), end: node.getEnd(), text: '<Th hidden />' })
          } else {
            let newText = '<Th hidden'
            for (const p of node.attributes.properties) {
              if (p === classAttr) continue
              newText += ` ${text.slice(p.getStart(), p.getEnd())}`
            }
            newText += '>'
            edits.push({ start: node.getStart(), end: node.getEnd(), text: newText })
            const el = node.parent
            if (ts.isJsxElement(el)) {
              edits.push({ start: el.closingElement.getStart(), end: el.closingElement.getEnd(), text: '</Th>' })
            }
          }
          needThImport = true
          report.converted.push(`${rel}: <th hidden> → <Th hidden>`)
        } else if (initExpr && !isStaticClass && !ts.isJsxSelfClosingElement(node)) {
          // 動的 className はタグだけ置き換えて残す
          edits.push({ start: node.tagName.getStart(), end: node.tagName.getEnd(), text: 'Th' })
          const el = node.parent
          if (ts.isJsxElement(el)) {
            edits.push({ start: el.closingElement.getStart(), end: el.closingElement.getEnd(), text: '</Th>' })
          }
          needThImport = true
          report.converted.push(`${rel}: <th> → Th（className残し）`)
        } else if (ts.isJsxSelfClosingElement(node)) {
          // <th/> は中身なし。className は align へ写して残りを保持する
          let align = null
          const kept = isStaticClass
            ? read.classes.filter((c) => {
                if (c === 'text-right') { align = 'right'; return false }
                if (c === 'text-center') { align = 'center'; return false }
                return !DROP_TH.has(c)
              })
            : null
          const attrs = []
          for (const p of node.attributes.properties) {
            if (p === classAttr) continue
            if (ts.isJsxAttribute(p) && p.name.getText() === 'scope' && p.initializer && ts.isStringLiteral(p.initializer) && p.initializer.text === 'col') continue
            attrs.push(text.slice(p.getStart(), p.getEnd()))
          }
          let newText = '<Th'
          if (align) newText += ` align="${align}"`
          if (kept === null && init) {
            attrs.unshift(text.slice(classAttr.getStart(), classAttr.getEnd()))
          } else if (kept?.length) {
            attrs.unshift(`className="${kept.join(' ')}"`)
          }
          if (attrs.length) newText += ' ' + attrs.join(' ')
          newText += ' />'
          edits.push({ start: node.getStart(), end: node.getEnd(), text: newText })
          needThImport = true
          report.converted.push(`${rel}: <th/> → <Th/>`)
        } else {
          let align = null
          const kept = read.classes.filter((c) => {
            if (c === 'text-right') { align = 'right'; return false }
            if (c === 'text-center') { align = 'center'; return false }
            return !DROP_TH.has(c)
          })
          // .cell の white-space:nowrap が漏れないよう打ち消す
          if (!read.classes.some((c) => /^(?:[a-z0-9-]+:)*whitespace-/.test(c))) {
            kept.push('whitespace-normal')
          }
          let newText = '<Th'
          if (align) newText += ` align="${align}"`
          if (kept.length) newText += ` className="${kept.join(' ')}"`
          for (const p of node.attributes.properties) {
            if (p === classAttr) continue
            if (ts.isJsxAttribute(p) && p.name.getText() === 'scope' && p.initializer && ts.isStringLiteral(p.initializer) && p.initializer.text === 'col') continue
            newText += ` ${text.slice(p.getStart(), p.getEnd())}`
          }
          newText += '>'
          edits.push({ start: node.getStart(), end: node.getEnd(), text: newText })
          const el = node.parent
          if (ts.isJsxElement(el)) {
            edits.push({ start: el.closingElement.getStart(), end: el.closingElement.getEnd(), text: '</Th>' })
          }
          needThImport = true
          report.converted.push(`${rel}: <th> → Th`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  if (!edits.length) continue
  if (collision) {
    report.skipped.push(`${rel}: Button/Th 名の衝突`)
    continue
  }

  if (APPLY) {
    let out = text
    for (const e of edits.sort((a, b) => b.start - a.start)) {
      out = out.slice(0, e.start) + e.text + out.slice(e.end)
    }
    // Link が完全に置き換わって import だけ残ったら消す
    if (!/<Link\b/.test(out) && !/\bLink\s*\(/.test(out)) {
      out = out.replace(/^import\s+Link\s+from\s+['"]next\/link['"];?[ \t]*\n/m, '')
    }
    // Th を既存の table import へ足す（先にやると挿入位置の計算に影響しない）
    if (needThImport) {
      const tm = out.match(/import\s*\{([^}]*)\}\s*from\s*'@\/components\/shared\/table'/)
      if (tm) {
        const names = tm[1].split(',').map((s) => s.trim()).filter(Boolean)
        if (!names.includes('Th')) {
          out = out.replace(tm[0], `import { ${[...names, 'Th'].join(', ')} } from '@/components/shared/table'`)
        }
        needThImport = false
      }
    }
    // 最後の import 文の終端（複数行 import 対応）の後へ挿入する
    const additions = []
    if (needButtonImport && !/from ['"]@\/components\/shared\/button['"]/.test(out)) {
      additions.push("import Button from '@/components/shared/button'")
    }
    if (needThImport) additions.push("import { Th } from '@/components/shared/table'")
    if (additions.length) {
      const importRe = /^import(?:[\s\S]*?\sfrom\s*)?['"][^'"]+['"];?/gm
      let last = null
      for (let m; (m = importRe.exec(out)); ) last = m
      const insertPos = last ? last.index + last[0].length : out.indexOf('\n') + 1
      out = out.slice(0, insertPos) + '\n' + additions.join('\n') + out.slice(insertPos)
    }
    writeFileSync(file, out)
  }
}

console.log(`converted: ${report.converted.length}`)
const byFile = {}
for (const c of report.converted) { const f = c.split(':')[0]; byFile[f] = (byFile[f] ?? 0) + 1 }
for (const [f, n] of Object.entries(byFile).sort()) console.log(`  + ${f} (${n})`)
console.log(`skipped: ${report.skipped.length}`)
for (const s of report.skipped) console.log('  -', s)
if (!APPLY) console.log('\n（ドライラン。--apply で書き換え）')
