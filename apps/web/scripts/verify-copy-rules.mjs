/**
 * 画面の言葉の書き方を見張る。管理画面と LIFF の製品ソースの文字列と JSX の文字を構文で読み、
 * 次の新しい追加を止める。
 *   - 全角の数字（１０）。数は半角で書く。
 *   - 「...」。三点は「…」で書く。
 *   - ブラウザの confirm()・alert()。確かめる窓は共通の Dialog を使う。
 * 正規表現の中の文字（全角の数字を半角へ直す処理など）は画面に出ないので読まない。
 * 利用規約などの決まりの文書は、文言を変えないので読まない。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff\uff01-\uff60]/
const LEGAL_DOCUMENT = /(?:^|\/)content\/terms\//
const BROWSER_DIALOGS = new Set(['confirm', 'alert'])
const BROWSER_GLOBALS = new Set(['window', 'globalThis', 'self'])

const EQUALITY = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken])
const isComparedValue = node => (ts.isBinaryExpression(node.parent) && EQUALITY.has(node.parent.operatorToken.kind)) || ts.isCaseClause(node.parent)

/** 1つのファイルの違反を返す。filename は種類（tsx か）と表示にだけ使う。 */
export function inspectCopySource(source, filename = 'screen.tsx') {
  const kind = filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, kind)
  const errors = []
  const add = (node, rule, text) => errors.push({ filename, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, rule, text: text.trim().slice(0, 60) })
  const readText = (node, text) => {
    // 受け取った値と比べる文字（古い書き方を受ける判定など）は画面に出さない。
    if (isComparedValue(node)) return
    if (/[０-９]/.test(text)) add(node, 'fullwidth-digit', text)
    if (/\.\.\./.test(text) && (JAPANESE.test(text) || /^\s*\.\.\.\s*$/.test(text))) add(node, 'ascii-ellipsis', text)
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) readText(node, node.text)
    else if (ts.isJsxText(node)) readText(node, node.text)
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const name = ts.isIdentifier(callee) ? callee.text
        : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && BROWSER_GLOBALS.has(callee.expression.text) ? callee.name.text : ''
      if (BROWSER_DIALOGS.has(name)) add(node, `browser-${name}`, node.getText(ast))
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return errors
}

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const file = path.join(dir, name)
    if (statSync(file).isDirectory()) sourceFiles(file, out)
    else if (/\.(?:tsx?|mjs)$/.test(name) && !/\.(?:test|spec)\.|\.d\.ts$/.test(name)) out.push(file)
  }
  return out
}

/** リポジトリの直下から、管理画面と LIFF の製品ソースを読む。 */
export function inspectCopyTree(root) {
  const errors = []
  let files = 0
  for (const dir of ['apps/web/src', 'apps/liff/src']) {
    for (const file of sourceFiles(path.join(root, dir))) {
      const relative = path.relative(root, file).split(path.sep).join('/')
      if (LEGAL_DOCUMENT.test(relative) || /(?:^|\/)(?:test-utils|fixtures)\//.test(relative)) continue
      files += 1
      errors.push(...inspectCopySource(readFileSync(file, 'utf8'), relative))
    }
  }
  return { files, errors }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectCopyTree(fileURLToPath(new URL('../../../', import.meta.url)))
  for (const item of result.errors) console.error(`${item.filename}:${item.line} ${item.rule} ${item.text}`)
  console.log(`画面の言葉：${result.files}ファイル・違反${result.errors.length}`)
  if (result.errors.length) process.exitCode = 1
}
