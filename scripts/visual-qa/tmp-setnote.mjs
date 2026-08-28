/** 注記を差し替える。`node<TAB>note` を行で受け取る。 */
import { readFileSync, writeFileSync } from 'node:fs'
const file = 'scripts/visual-qa/screens.mjs'
const rows = readFileSync(process.argv[2], 'utf8').split('\n')
  .filter((l) => l.trim() && !l.startsWith('#'))
  .map((l) => l.split('\t'))
let s = readFileSync(file, 'utf8')
const esc = (t) => t.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
let n = 0, miss = []
for (const [node, note] of rows) {
  const i = s.indexOf(`node: '${node}'`)
  if (i < 0) { miss.push(`${node}: 行が無い`); continue }
  const j = s.indexOf("verdictNote: '", i)
  if (j < 0) { miss.push(`${node}: 注記が無い`); continue }
  const start = j + "verdictNote: '".length
  let k = start
  while (k < s.length) {
    if (s[k] === '\\') { k += 2; continue }
    if (s[k] === "'") break
    k += 1
  }
  s = s.slice(0, start) + esc(note) + s.slice(k)
  n += 1
}
writeFileSync(file, s)
console.log(`注記を書き直した ${n}件`)
if (miss.length) console.log('できなかったもの:\n  ' + miss.join('\n  '))
