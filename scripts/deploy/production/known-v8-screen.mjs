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

/** The presentation inventory has its own route list and reports both scanner
 * findings and load errors. Accept only measurements already present in the
 * published staging build; a newly missing route or an extra finding fails. */
export function checkKnownV8Presentation(current, baseline) {
  if (!Array.isArray(current) || !Array.isArray(baseline)) throw new Error('v8_presentation_missing')
  const expectedWidths = [1024, 1152, 1440]
  function index(rows) {
    const map = new Map()
    for (const row of rows) {
      if (!expectedWidths.includes(row?.width) || typeof row.route !== 'string') throw new Error('v8_presentation_invalid_row')
      const key = `${row.width} ${row.route}`
      if (map.has(key)) throw new Error(`v8_presentation_duplicate ${key}`)
      map.set(key, row)
    }
    return map
  }
  const currentByRoute = index(current), baselineByRoute = index(baseline)
  if (baselineByRoute.size !== 789 || currentByRoute.size !== baselineByRoute.size || [...currentByRoute.keys()].some(key => !baselineByRoute.has(key))) throw new Error('v8_presentation_routes_incomplete')
  for (const width of expectedWidths) if ([...currentByRoute.keys()].filter(key => key.startsWith(`${width} `)).length !== 263) throw new Error('v8_presentation_width_incomplete')
  let knownFindings = 0, knownErrors = 0
  function assertNoNew(currentValues, baselineValues, key, kind) {
    if (!Array.isArray(currentValues) || !Array.isArray(baselineValues)) throw new Error(`v8_presentation_measurement_missing ${key} ${kind}`)
    const allowed = new Map()
    for (const value of baselineValues) {
      const signature = canonical(value)
      allowed.set(signature, (allowed.get(signature) ?? 0) + 1)
    }
    for (const value of currentValues) {
      const signature = canonical(value), count = allowed.get(signature) ?? 0
      if (count === 0) throw new Error(`v8_presentation_new_${kind} ${key}`)
      allowed.set(signature, count - 1)
    }
  }
  for (const [key, row] of currentByRoute) {
    const base = baselineByRoute.get(key)
    if (row.error || base.error) {
      if (!row.error || row.error !== base.error) throw new Error(`v8_presentation_new_error ${key}`)
      knownErrors++
      continue
    }
    if (row.finalPath !== base.finalPath) throw new Error(`v8_presentation_path_changed ${key}`)
    assertNoNew(row.errors, base.errors, key, 'error')
    assertNoNew(row.findings, base.findings, key, 'finding')
    assertNoNew(row.missingDots, base.missingDots, key, 'missing_dot')
    knownFindings += row.findings.length
    knownErrors += row.errors.length
  }
  return { routes: currentByRoute.size, knownFindings, knownErrors }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === '--presentation') {
    const [, , , currentPath, baselinePath] = process.argv
    if (!currentPath || !baselinePath) throw new Error('v8_presentation_paths_missing')
    const result = checkKnownV8Presentation(JSON.parse(readFileSync(currentPath, 'utf8')), JSON.parse(readFileSync(baselinePath, 'utf8')))
    console.log(`検証公開版と同一の画面監査結果: ${result.knownFindings}件 / ${result.routes}画面。既知の取得失敗: ${result.knownErrors}件。新規指摘なし。`)
  } else {
    const path = process.argv[2]
    if (!path) throw new Error('v8_result_path_missing')
    const result = checkKnownV8Screen(JSON.parse(readFileSync(path, 'utf8')))
    console.log(`検証公開版と同一の指摘: ${result.findings}件 / ${result.routes}画面。転送専用の旧入口: ${result.redirects}画面。新規指摘なし。`)
  }
}
