import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SpeedLimitError, runSpeedAssertion } from './speed-outcome.mjs'
import { speedPolicy } from './speed-policy.mjs'

/** 絶対目標を別途比較する。CIの時間倍率だけ補正し、欠測は超過と区別して失敗。 */
export function assertStressTargets(result, policy = speedPolicy('local')) {
  if (result.complete !== true || result.error) throw new Error(`速度測定が未完了です: ${result.error ?? '完了の証拠なし'}`)
  const sample = result.measured?.find((item) => item.name === 'friends-2000')
  if (!sample || sample.rows !== 2000 || !Number.isInteger(sample.renderedRows) || sample.renderedRows < 1) {
    throw new Error('2,000件の応答と実際に描いた行の証拠がありません')
  }
  const exceedances = []
  for (const [metric, target] of [['showMs', 1000], ['longTaskMs', 50]]) {
    const limit = target * policy.timeFactor
    if (!Number.isFinite(sample[metric]) || sample[metric] < 0) {
      throw new Error(`friends-2000 ${metric}=${sample[metric]}（上限 ${limit}ms）`)
    }
    if (sample[metric] > limit) exceedances.push({ screen: 'friends-2000', metric, value: sample[metric], limit, unit: 'ms', check: 'stress' })
  }
  if (exceedances.length) throw new SpeedLimitError(exceedances)
  return sample
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result=JSON.parse(readFileSync(process.argv[2], 'utf8'))
  // 同じ結果を読む場所のCI環境変数で、50ms/65msを入れ替えない。
  const policy=result.policy?speedPolicy(result.policy.profile):speedPolicy()
  if(result.policy && (result.policy.timeFactor!==policy.timeFactor || result.policy.sampleCount!==policy.sampleCount)) throw new Error('保存した測定条件が不正です')
  runSpeedAssertion(() => assertStressTargets(result, policy))
}
