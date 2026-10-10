import { readFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** continue-on-errorでも未完了を合格と表示しない。生のoutcomeを使う。 */
export function speedReport(result, outcomes) {
  const complete = result?.complete === true && !result?.error
  const passed = complete && outcomes.budget === 'success' && outcomes.stress === 'success' && outcomes.perf3 === 'success'
  return {
    warning: !passed,
    text: !complete
      ? `速度検査: 測定未完了（${result?.error ?? '結果または完了の証拠がありません'}）。参考チェックのためPRは止めません。`
      : passed
        ? '速度検査: 測定完了・予算と目標に合格（PERF-01のタグ1秒・長い処理65msを含む参考チェック）。'
        : `速度検査: 測定完了・超過または判定失敗（予算=${outcomes.budget}、2,000人=${outcomes.stress}、PERF-01=${outcomes.perf3}）。参考チェックのためPRは止めません。`,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let result = null
  try { result = JSON.parse(readFileSync(process.argv[2], 'utf8')) } catch (error) {
    result = { complete: false, error: `結果を読めません: ${error.message}` }
  }
  const report = speedReport(result, { budget: process.env.SPEED_BUDGET_OUTCOME, stress: process.env.STRESS_SPEED_OUTCOME, perf3: process.env.PERF3_TARGETS_OUTCOME })
  // Actionsの注釈は改行と%を符号化。測定エラーに含まれる文字を制御命令にしない。
  const annotation = report.text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
  console.log(report.warning ? `::warning::${annotation}` : report.text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report.text}\n`)
}
