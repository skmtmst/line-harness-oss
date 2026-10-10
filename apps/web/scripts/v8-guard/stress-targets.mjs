import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { speedPolicy } from './speed-policy.mjs'

/** 絶対目標を別途比較する。CIの時間倍率だけ補正し、欠測は超過と区別して失敗。 */
export function assertStressTargets(result, policy = speedPolicy('local')) {
  if (result.complete !== true || result.error) throw new Error(`速度測定が未完了です: ${result.error ?? '完了の証拠なし'}`)
  const sample = result.measured?.find((item) => item.name === 'friends-2000')
  if (!sample || sample.rows !== 2000 || !Number.isInteger(sample.renderedRows) || sample.renderedRows < 1) {
    throw new Error('2,000件の応答と実際に描いた行の証拠がありません')
  }
  for (const [metric, target] of [['showMs', 1000], ['longTaskMs', 50]]) {
    const limit = target * policy.timeFactor
    if (!Number.isFinite(sample[metric]) || sample[metric] < 0 || sample[metric] > limit) {
      throw new Error(`friends-2000 ${metric}=${sample[metric]}（上限 ${limit}ms）`)
    }
  }
  return sample
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sample = assertStressTargets(JSON.parse(readFileSync(process.argv[2], 'utf8')), speedPolicy())
  console.log(`2,000行: 表示 ${sample.showMs}ms・最大長時間処理 ${sample.longTaskMs}ms・描画 ${sample.renderedRows}行`)
}
