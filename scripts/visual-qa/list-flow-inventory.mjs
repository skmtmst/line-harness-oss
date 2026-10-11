/** rgでV8の表を拾い、共通行の開き方を分類する。--base <git ref>で変更前も数える。 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import ts from 'typescript'
const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2)
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : null
const files = execFileSync('rg', ['--files', 'apps/web/src/v8', '-g', '*.tsx', '-g', '!*.test.tsx'], { cwd: root, encoding: 'utf8' }).trim().split('\n')
const rows = []
for (const file of files) {
  let source
  try { source = base ? execFileSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) : readFileSync(join(root, file), 'utf8') } catch { continue }
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const visit = node => {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === 'Tr') {
      const attrs = node.attributes.properties.map(attr => attr.name?.getText(ast))
      const intent = attrs.includes('onOpen') ? 'onOpen' : attrs.includes('href') ? 'href' : attrs.includes('onClick') ? 'onClick' : '名前の共通リンク／記録・設定行'
      rows.push({ file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, intent })
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
}
const counts = rows.reduce((result, row) => { result[row.intent] = (result[row.intent] ?? 0) + 1; return result }, {})
console.log(JSON.stringify({ base, total: rows.length, counts, rows }, null, 2))
