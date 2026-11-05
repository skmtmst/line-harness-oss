/** One release only: compare every V8 finding with the already published staging build.
 * The ordinary screen guard still fails on every finding. This does not change it.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DEFECT_ROUTES } from '../../../apps/web/scripts/v8-guard/layout-defects.mjs'
import { WIDTHS } from '../../../apps/web/scripts/v8-guard/browser-env.mjs'

const redirect = '/conversions' // This legacy route intentionally redirects to /affiliates.
const redirectError = '指定画面を開けませんでした'

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

/** A current finding is accepted only if the same route, width and full measurement
 * occurred at the staging SHA. Missing measurements and extra duplicates fail.
 */
export function checkKnownV8Screen(results) {
  if (!results || typeof results !== 'object' || Array.isArray(results)) throw new Error('v8_result_missing')
  const expected = new Set(WIDTHS.flatMap(width => [...new Set(Object.values(DEFECT_ROUTES))].map(route => `${width} ${route}`)))
  const actual = Object.keys(results)
  if (actual.length !== expected.size || actual.some(key => !expected.has(key))) throw new Error('v8_routes_incomplete')
  let findings = 0, redirects = 0
  for (const key of expected) {
    const row = results[key]
    if (!row || typeof row !== 'object') throw new Error(`v8_result_missing ${key}`)
    if (Object.hasOwn(row, 'error')) {
      if (!key.endsWith(` ${redirect}`) || row.error !== redirectError) throw new Error(`v8_measurement_error ${key}`)
      redirects++
      continue
    }
    if (!Array.isArray(row.failures) || !Array.isArray(row.baseFindings)) throw new Error(`v8_comparison_missing ${key}`)
    const known = new Map()
    for (const finding of row.baseFindings) {
      const signature = canonical(finding)
      known.set(signature, (known.get(signature) ?? 0) + 1)
    }
    for (const finding of row.failures) {
      const signature = canonical(finding), count = known.get(signature) ?? 0
      if (count === 0) throw new Error(`v8_new_finding ${key} ${finding.kind ?? 'unknown'}`)
      known.set(signature, count - 1)
      findings++
    }
  }
  if (redirects !== WIDTHS.length) throw new Error('v8_redirect_measurements_missing')
  return { routes: expected.size, findings, redirects }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const path = process.argv[2]
  if (!path) throw new Error('v8_result_path_missing')
  const result = checkKnownV8Screen(JSON.parse(readFileSync(path, 'utf8')))
  console.log(`検証公開版と同一の指摘: ${result.findings}件 / ${result.routes}画面。転送専用の旧入口: ${result.redirects}画面。新規指摘なし。`)
}
