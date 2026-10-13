import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { median } from './speed-budget.mjs'

/** PERF-01 has fixed limits; diagnostic overhead is excluded and missing runs cannot pass. */
export function assertPerf3Targets(result) {
  if (result.complete !== true) throw new Error('速度測定が未完了です')
  const measurements = result.results ?? result.measured?.map(sample => ({ ...sample, diagnostic: false }))
  for (const [name, key, limit] of [['tags', 'showMs', 1000], ['friends-2000', 'longTaskMs', 65]]) {
    const measured = measurements?.find(r => r.name === name && r.diagnostic === false)
    if (!measured || !Array.isArray(measured.samples) || measured.samples.length < 3) throw new Error(`${name}: 同じ条件で3回以上の測定が必要です`)
    const values = measured.samples.map(sample => sample[key])
    if (values.some(value => !Number.isFinite(value) || value < 0)) throw new Error(`${name}: ${key}が欠測です`)
    if (name === 'friends-2000' && measured.samples.some(s => s.rows !== 2000 || !Number.isInteger(s.renderedRows) || s.renderedRows < 1)) throw new Error('2,000件の取得・描画の証拠がありません')
    const value = median(values)
    if (value > limit) throw new Error(`${name}: ${key}=${value}ms（上限${limit}ms）`)
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    assertPerf3Targets(JSON.parse(readFileSync(process.argv[2], 'utf8')))
  } catch (error) {
    console.error(`::warning::PERF-01: ${error.message}`)
    process.exitCode = 1
  }
  if (process.exitCode) process.exit(process.exitCode)
  console.log('PERF-01: タグ一覧1,000ms・2,000件の長い処理65ms以内')
}
