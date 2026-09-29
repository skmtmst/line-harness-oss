/*
  Pencil の「機能まるごと1枚」の書き出しを、画面ごとの HTML に割る。

  **絵は1ノード1ファイルでないと使えない。** 複数入れて書き出すと
  幅4000の横並び1枚になり、設計画像として並べられない。
  かといって1ノードずつ書き出すのは、262画面ぶんの往復になる。

  そこで文字と同じく、まるごと1回書き出してからここで割る。
  割った先は `capture-screens.mjs --design --from <dir>` にそのまま渡せる。

  使い方:
    node scripts/visual-qa/split-design-html.mjs --html <f1.html> --out <dir> --nodes a,b,c
*/
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : null
}

const htmlPath = arg('html')
const outDir = arg('out')
const nodes = (arg('nodes') ?? '').split(',').filter(Boolean)
if (!htmlPath || !outDir || nodes.length === 0) {
  console.error('使い方: --html <file> --out <dir> --nodes a,b,c')
  process.exit(1)
}

const src = readFileSync(htmlPath, 'utf8')
const [head, body] = src.split('<body>')
if (body === undefined) {
  console.error('<body> が無い。書き出しに includeHtmlScaffold を付けてください。')
  process.exit(1)
}

/*
  画面の最上位は `★ V6 <番号>` で始まる。
  **`★` だけでは足りない**（中の部品にも `★項目` `★タグ` がある）。
*/
const marks = [...body.matchAll(/data-pencil-name="(★ V6 [^"]*)"/g)]
if (marks.length !== nodes.length) {
  console.error(`画面の数が合わない: HTML に ${marks.length}、--nodes に ${nodes.length}`)
  for (const m of marks) console.error('  HTML:', m[1])
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
for (let i = 0; i < marks.length; i += 1) {
  // 印は属性の途中なので、そのタグの頭から次のタグの頭まで。
  const start = body.lastIndexOf('<', marks[i].index)
  const end = i + 1 < marks.length ? body.lastIndexOf('<', marks[i + 1].index) : body.lastIndexOf('</body>')
  /*
    **置き場所を0に戻す。**
    まるごと1枚の書き出しでは、画面が `left: 2080px` のように横へ並べてある。
    そのまま割ると、1枚目は 1920px でも5枚目は 10240px の絵になる
    （左に空白がそのぶん入る）。実際に機能1で 4000〜10240px の絵ができた。
    最上位のタグの `left`/`top` だけ0にする（中の要素の位置は触らない）。
  */
  const piece = body.slice(start, end)
  const openEnd = piece.indexOf('>')
  const opening = piece.slice(0, openEnd)
    .replace(/left:\s*-?\d+(\.\d+)?px/, 'left: 0px')
    .replace(/top:\s*-?\d+(\.\d+)?px/, 'top: 0px')
  writeFileSync(join(outDir, `${nodes[i]}.html`), `${head}<body>\n${opening}${piece.slice(openEnd)}\n</body></html>\n`)
  console.log(`${nodes[i]}\t${marks[i][1]}`)
}
