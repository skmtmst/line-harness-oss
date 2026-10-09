import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 画面が分割されても、入り口だけで操作や契約が消えたと判定しない。
// 共通部品の内部や別画面は含めず、その画面のローカルな実装を読む。
//
// V8 の新しい画面は src/v8 に一から書き、入口（app/<画面>/page.tsx）が `@/v8/...` で読む
// （2026-10-06〜）。入口を読んだ試験が新しい画面の中身まで見られるよう、`@/v8/` の import も
// たどる（`@/` は src/ に解決する）。`@/components` などほかの `@/` は共通部品なのでたどらない。
export function readUiSource(path, encoding = 'utf8') {
  const full = resolve(path instanceof URL ? fileURLToPath(path) : String(path))
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
  // B-40: 廃止されたapp内のV8コピーは、そのURLの今の入口へ読み替える。
  // 現役の分割部品は読み替えない。共通部品・CSS・JSONも元の読み口を保つ。
  if (full.includes('/src/app/') && /(?:^v8-|[-.]v8\.tsx?$)/.test(full.split('/').at(-1))) {
    const routes = {
      'tags/field-migrate-v8.tsx': 'tags/fields/migrate/page.tsx',
      'tags/edit-tag-page-v8.tsx': 'tags/edit/page.tsx',
      'tags/field-editor-v8.tsx': 'tags/fields/edit/page.tsx',
      'tags/mark-editor-v8.tsx': 'tags/marks/edit/page.tsx',
      'templates/edit-v8.tsx': 'templates/edit/page.tsx',
      'templates/editor-v8.tsx': 'templates/edit/page.tsx',
      'reminders/basics-form-v8.tsx': 'reminders/new/page.tsx',
      'affiliates/new-affiliate-v8.tsx': 'affiliates/new/page.tsx',
      'affiliate-offers/new-offer-v8.tsx': 'affiliate-offers/new/page.tsx',
      'broadcasts/reserved-v8.tsx': 'broadcasts/reserved/page.tsx',
      'broadcasts/detail-v8.tsx': 'broadcasts/detail/page.tsx',
      'tags/search-editor-v8.tsx': 'tags/searches/edit/page.tsx',
    }
    if (full.endsWith('/hq/hq-settings-nav-v8.tsx')) return read(resolve(SRC, 'v8/hq/settings-nav.tsx'), 0)
    const relative = full.slice(full.indexOf('/src/app/') + 9)
    const entry = routes[relative] ? resolve(SRC, 'app', routes[relative]) : resolve(dirname(full), 'page.tsx')
    if (entry !== full && existsSync(entry)) {
      const entrySource = readFileSync(entry, encoding)
      const roots = [...entrySource.matchAll(/from\s*['"](@\/v8\/[^'"]+)['"]/g)]
      const rootFiles = roots.map((match) => {
        const base = resolve(SRC, match[1].slice(2))
        return existsSync(`${base}.tsx`) ? `${base}.tsx` : `${base}.ts`
      })
      const current = rootFiles.length ? rootFiles.map((file) => read(file, 0)).join('\n') : read(entry, 0)
      if (!seen.has(full)) {
        // 分割されたタブの試験は同名の現役タブを読む（ほかのタブを混ぜない）。
        const basename = full.split('/').at(-1).replace(/-v8\.tsx?$/, '.tsx').replace(/^v8-/, '')
        const matching = [...seen].find((file) => file.split('/').at(-1) === basename)
        if (matching && !rootFiles.includes(matching)) { seen.clear(); return read(matching, 0) }
        return current
      }
      seen.clear()
    }
  }
  return read(full, 0)
}
