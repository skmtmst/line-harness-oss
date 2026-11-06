import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** ソースを読む検査・模擬APIが、公開口から実装の移動先まで同じ入力を読む。 */
export function readApiSources(entry) {
  const start = entry instanceof URL ? fileURLToPath(entry) : resolve(entry)
  const implementation = join(dirname(start), 'api')
  const files = new Map()
  function visit(file) {
    if (files.has(file)) return
    const source = readFileSync(file, 'utf8')
    files.set(file, source)
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\()['"](\.[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), match[1] + '.ts')
      if (target.startsWith(implementation + '/')) visit(target)
    }
  }
  visit(start)
  return files
}

/** readFileSync と同じ呼出し形。API以外のソースはそのまま読む。 */
export function readApiSource(entry, encoding = 'utf8') {
  const file = entry instanceof URL ? fileURLToPath(entry) : resolve(entry)
  if (!file.endsWith('/lib/api.ts')) return readFileSync(entry, encoding)
  return [...readApiSources(file).values()].join('\n\n')
}
