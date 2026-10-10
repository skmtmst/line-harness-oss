import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Absolute goal, independently of the historical regression allowance. Never change the baseline. */
export function assertStressTargets(result) {
  const sample = result.measured?.find((item) => item.name === 'friends-2000')
  if (!sample || sample.rows !== 2000 || !Number.isInteger(sample.renderedRows) || sample.renderedRows < 1) {
    throw new Error('2,000件の応答と実際に描いた行の証拠がありません')
  }
  for (const [metric, limit] of [['showMs', 1000], ['longTaskMs', 50]]) {
    if (!Number.isFinite(sample[metric]) || sample[metric] < 0 || sample[metric] > limit) {
      throw new Error(`friends-2000 ${metric}=${sample[metric]}（上限 ${limit}ms）`)
    }
  }
  return sample
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sample = assertStressTargets(JSON.parse(readFileSync(process.argv[2], 'utf8')))
  console.log(`2,000行: 表示 ${sample.showMs}ms・最大長時間処理 ${sample.longTaskMs}ms・描画 ${sample.renderedRows}行`)
}
