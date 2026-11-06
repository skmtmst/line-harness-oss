import { appendFileSync } from 'node:fs'

export function speedEnforcement(env = process.env) {
  const mode = env.V8_SPEED_ENFORCEMENT || 'report'
  if (!['report', 'enforce'].includes(mode)) throw new Error(`未知の速度判定: ${mode}`)
  return mode
}

export class SpeedLimitError extends Error {
  constructor(exceedances) {
    super(exceedances.map(row => `${row.screen}: ${row.metric}=${row.value}${row.unit}（上限${row.limit}${row.unit}）`).join('\n'))
    this.exceedances = exceedances
  }
}

export function speedSummary(exceedances) {
  const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
  return ['## 速さの上限を超えた物', '', '| 画面 | 項目 | 測った数 | 上限 | 超えた量 |', '| --- | --- | ---: | ---: | ---: |',
    ...exceedances.map(row => `| ${cell(row.screen)} | ${cell(row.metric)} | ${row.value}${row.unit} | ${row.limit}${row.unit} | +${Number((row.value - row.limit).toFixed(2))}${row.unit} |`),
    ...(exceedances.length ? [] : ['| — | 超過なし | — | — | — |']), ''].join('\n')
}

export function finishSpeedCheck(exceedances, label = '速度検査') {
  const mode = speedEnforcement()
  console.log(`${label}: 測定完了・超過${exceedances.length}件（${mode}）`)
  console.log(speedSummary(exceedances))
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${speedSummary(exceedances)}\n`)
  return mode === 'enforce' && exceedances.length ? 1 : 0
}

export function runSpeedAssertion(check) {
  try {
    check()
    process.exitCode = finishSpeedCheck([])
  } catch (error) {
    if (!(error instanceof SpeedLimitError)) throw error
    process.exitCode = finishSpeedCheck(error.exceedances)
  }
}
