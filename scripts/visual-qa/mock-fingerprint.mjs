import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 起動時の返事と撮影直前のディスクを同じ方法で照合する。 */
export function mockFingerprint(entry = new URL('./mock-api.mjs', import.meta.url), inputs = [new URL('../../apps/web/src/lib/api.ts', import.meta.url)]) {
  const files = new Map()
  const visit = (url) => {
    const path = fileURLToPath(url)
    if (files.has(path)) return
    const source = readFileSync(path, 'utf8')
    files.set(path, source)
    // 静的なローカル依存を再帰的に読む。循環と重複は files で止める。
    for (const match of source.matchAll(/^import\s+(?:[^;]*?\s+from\s*)?['"](\.[^'"]+)['"]/gm)) {
      visit(new URL(match[1], url))
    }
  }
  visit(entry)
  // api-shapes は import ではなくファイルを読むので、その入力も含める。
  for (const url of inputs) visit(url)
  const root = dirname(fileURLToPath(entry))
  const hash = createHash('sha256')
  for (const [path, source] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(relative(root, path)).update('\0').update(source).update('\0')
  }
  return hash.digest('hex').slice(0, 16)
}
