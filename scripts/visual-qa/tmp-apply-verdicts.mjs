import { readFileSync, writeFileSync } from 'node:fs'
const tsv = process.argv[2]
const file = 'scripts/visual-qa/screens.mjs'
const rows = readFileSync(tsv, 'utf8').split('\n')
  .filter((l) => l.trim() && !l.startsWith('#'))
  .map((l) => l.split('\t'))
let src = readFileSync(file, 'utf8')
const lines = src.split('\n')
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
let applied = 0, skipped = []
for (const [node, verdict, note, source, head] of rows) {
  const idx = lines.findIndex((l) => l.includes(`node: '${node}'`))
  if (idx < 0) { skipped.push(`${node}: 行が見つからない`); continue }
  if (lines.slice(idx, idx + 1).join('').includes('verdict:')) { skipped.push(`${node}: すでに判定がある`); continue }
  const add = `    verdict: '${verdict}', verdictNote: '${esc(note)}',\n    verdictSource: '${esc(source)}', verdictHead: '${head}',`
  const line = lines[idx]
  if (/\},\s*$/.test(line)) {
    // 1行の行オブジェクト: 末尾の `},` の直前へ入れる
    const m = line.match(/^(\s*)(.*)\},\s*$/)
    if (!m) { skipped.push(`${node}: 1行の形が読めない`); continue }
    lines[idx] = `${m[1]}${m[2].trimEnd().replace(/,$/, '')},\n${add}\n${m[1]}},`
  } else {
    let end = -1
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^\s{2}\},\s*$/.test(lines[i])) { end = i; break }
    }
    if (end < 0) { skipped.push(`${node}: 終わりが見つからない`); continue }
    const block = lines.slice(idx, end).join('\n')
    if (block.includes('verdict:')) { skipped.push(`${node}: すでに判定がある`); continue }
    lines.splice(end, 0, add)
  }
  applied++
}
writeFileSync(file, lines.join('\n'))
console.log(`入れた ${applied} 件`)
if (skipped.length) console.log('入れなかったもの:\n  ' + skipped.join('\n  '))
