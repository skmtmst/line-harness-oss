/*
  Pencil から書き出した「機能まるごと1枚」の HTML を、画面ごとの文字に割る。

  なぜ機能まるごとで書き出すか:
    **画像は1ノード1ファイルでないと使えない**（複数入れると幅4000の横並びになる）。
    けれど文字を取るだけなら並びは関係ないので、1回の書き出しで済ませられる。

  割り方:
    画面の最上位ノードは `data-pencil-name="★ V6 …"` で始まる。
    その出現位置で切り、`--nodes` に渡した並びと突き合わせる。
    **数が合わなければ止める。** ずれたまま進むと、別の画面の文字を
    その画面のものとして台帳に書いてしまう。

  使い方:
    node scripts/visual-qa/design-text.mjs --html <f15.html> --dir media-v6 --nodes g89Tc,voJtX,...
*/
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : null
}

/** タグを落として、見える文字だけにする。 */
function textOf(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
}

const htmlPath = arg('html')
const dir = arg('dir')
const nodes = (arg('nodes') ?? '').split(',').filter(Boolean)
if (!htmlPath || !dir || nodes.length === 0) {
  console.error('使い方: --html <file> --dir <design-reference の下の名前> --nodes a,b,c')
  process.exit(1)
}

const html = readFileSync(htmlPath, 'utf8')
const body = html.slice(html.indexOf('<body>'))
/*
  画面の最上位ノードだけを拾う。

  **`★` だけでは足りない。** 中の部品にも `★項目 会員ランク` `★タグ` のような
  名前が付いていて、機能3で4つ渡したのに9つ見つかった。
  画面は必ず `★ V6 <番号>` で始まるので、そこまで見る。
*/
const marks = [...body.matchAll(/data-pencil-name="(★ V6 [^"]*)"/g)]

if (marks.length !== nodes.length) {
  console.error(`画面の数が合わない: HTML に ${marks.length}、--nodes に ${nodes.length}`)
  for (const m of marks) console.error('  HTML:', m[1])
  process.exit(1)
}

const out = join(ROOT, 'docs', 'design-reference', dir)
mkdirSync(out, { recursive: true })
for (let i = 0; i < marks.length; i += 1) {
  // 印は属性の途中なので、そのタグを閉じた次から取る。
  // ここを外すと `data-pencil-name="…"` や `<div` が文字として混ざる。
  const start = body.indexOf('>', marks[i].index) + 1
  // 次の画面は、その印を**含むタグの頭**で切る。
  // 印の位置で切ると、開きかけの `<div` が文字として残る。
  const end = i + 1 < marks.length ? body.lastIndexOf('<', marks[i + 1].index) : body.length
  const text = textOf(body.slice(start, end))
  const file = join(out, `${nodes[i]}.txt`)
  writeFileSync(file, `# ${marks[i][1]}\n\n${text}\n`)
  console.log(`${nodes[i]}\t${marks[i][1]}\t${text.split('\n').length}行`)
}
