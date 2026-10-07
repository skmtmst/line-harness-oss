import { readFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 画面が分割されても、入り口だけで操作や契約が消えたと判定しない。
// 共通部品の内部や別画面は含めず、その画面のローカルな実装を読む。
//
// V8 の新しい画面は src/v8 に一から書き、入口（app/<画面>/page.tsx）が `@/v8/...` で読む
// （2026-10-06〜）。入口を読んだ試験が新しい画面の中身まで見られるよう、`@/v8/` の import も
// たどる（`@/` は src/ に解決する）。`@/components` などほかの `@/` は共通部品なのでたどらない。
export function readUiSource(path, encoding = 'utf8') {
  const full = path instanceof URL ? fileURLToPath(path) : String(path)
  // `@/` の行き先（apps/web/src）。読むファイルの道筋から決める（試験によっては import.meta.url が file: でない）。
  const srcAt = full.lastIndexOf('/src/')
  const SRC = srcAt >= 0 ? full.slice(0, srcAt + 5) : resolve(process.cwd(), 'src')
  const seen = new Set()
  function read(file, depth) {
    if (seen.has(file)) return ''
    seen.add(file)
    const source = readFileSync(file, encoding)
    if (!['.tsx', '.ts'].includes(extname(file)) || typeof source !== 'string' || depth > 4) return source
    let result = source
    for (const match of source.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)['"](\.[^'"]+|@\/v8\/[^'"]+)['"]/g)) {
      const spec = match[1]
      const base = spec.startsWith('@/') ? resolve(SRC, spec.slice(2)) : resolve(dirname(file), spec)
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
