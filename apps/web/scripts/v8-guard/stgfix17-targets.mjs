import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { median } from './speed-budget.mjs'

/** 列車17の未達4項目。時間倍率を掛けず、元の絶対目標で比較する。 */
export function assertStgfix17Targets(result) {
  if (!result.complete || result.error) throw new Error('速度測定が未完了です')
  for (const [name, metric, limit] of [
    ['dashboard', 'showMs', 1000],
    ['broadcasts', 'longTaskMs', 50],
    ['broadcast-new', 'longTaskMs', 50],
    ['friends-2000', 'longTaskMs', 50],
  ]) {
    const measurement = result.measured?.find(m => m.name === name)
    if (!measurement || measurement.samples?.length !== 5) throw new Error(`${name}: 5回の測定が必要です`)
    const values = measurement.samples.map(s => s[metric])
    if (values.some(v => !Number.isFinite(v) || v < 0)) throw new Error(`${name}: ${metric}が欠測です`)
    if (name === 'friends-2000' && measurement.samples.some(s => s.rows !== 2000 || !(s.renderedRows > 0))) throw new Error('2,000件の取得・描画の証拠がありません')
    const value = median(values)
    if (measurement[metric] !== value || value > limit) throw new Error(`${name}: ${metric}=${value}ms（上限${limit}ms）`)
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assertStgfix17Targets(JSON.parse(readFileSync(process.argv[2], 'utf8')))
  console.log('列車17の4項目: 表示1,000ms・長い処理50ms以内')
}
