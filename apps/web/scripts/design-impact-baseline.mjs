import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
export const DESIGN_IMPACT_BASELINE = join(WEB, 'design', 'design-impact-baseline.txt')

const KIND_TO_KEY = {
  'shared-button-importer': 'sharedButtonImporters',
  'button-migration-target': 'buttonMigrationTargets',
  'table-header-migration-target': 'tableHeaderMigrationTargets',
  'native-table-header-exception': 'nativeTableHeaderExceptions',
}

/**
 * 1行1件の一覧を読む。JSON配列にしないのは、並行PRが末尾の `]` を同時に
 * 動かして競合するのを避けるため。`.gitattributes` の union merge と組み合わせ、
 * 別画面を足した2本のPRの行をどちらも残す。
 */
export function parseDesignImpactBaseline(source) {
  const result = Object.fromEntries(Object.values(KIND_TO_KEY).map((key) => [key, []]))
  const seen = new Set()

  source.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return

    const match = /^(\S+)\s+(\S+)$/.exec(line)
    if (!match || !(match[1] in KIND_TO_KEY)) {
      throw new Error(`design-impact-baseline.txt:${index + 1}: 知らない行です: ${line}`)
    }
    const [, kind, path] = match
    if (path.startsWith('/') || path.includes('..')) {
      throw new Error(`design-impact-baseline.txt:${index + 1}: srcからの相対パスで書いてください: ${path}`)
    }

    const entry = `${kind} ${path}`
    if (seen.has(entry)) {
      throw new Error(`design-impact-baseline.txt:${index + 1}: 同じ行が二重です: ${entry}`)
    }
    seen.add(entry)
    result[KIND_TO_KEY[kind]].push(path)
  })

  for (const entries of Object.values(result)) entries.sort()
  return result
}

export function readDesignImpactBaseline() {
  return parseDesignImpactBaseline(readFileSync(DESIGN_IMPACT_BASELINE, 'utf8'))
}
