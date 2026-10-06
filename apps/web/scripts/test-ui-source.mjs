import { readFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 画面が分割されても、入り口だけで操作や契約が消えたと判定しない。
// 共通部品の内部や別画面は含めず、その画面のローカルな実装を読む。
export function readUiSource(path, encoding = 'utf8') {
  const full = path instanceof URL ? fileURLToPath(path) : String(path)
  const seen = new Set()
  function read(file, depth) {
    if (seen.has(file)) return ''
    seen.add(file)
    const source = readFileSync(file, encoding)
    if (!['.tsx', '.ts'].includes(extname(file)) || typeof source !== 'string' || depth > 4) return source
    let result = source
    for (const match of source.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)['"](\.[^'"]+)['"]/g)) {
      const base = resolve(dirname(file), match[1])
      if (/\.test\./.test(base)) continue
      for (const child of [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`]) {
        if (!['.tsx', '.ts'].includes(extname(child))) continue
        try { result += '\n' + read(child, depth + 1); break } catch { /* 次の候補 */ }
      }
    }
    return result
  }
  return read(full, 0)
}
