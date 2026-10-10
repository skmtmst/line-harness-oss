import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { measureMedian, judge, median, stubApi } from './speed-budget.mjs'
import { speedPolicy } from './speed-policy.mjs'
import { assertStressTargets } from './stress-targets.mjs'
import { speedReport } from './speed-report.mjs'

const base = { showMs: 1000, lcpMs: 300, pressMs: 67, longTaskMs: 50, jsBytes: 10000 }
const sample = { name: 'inbox', ...base }
const stress = { name: 'friends-2000', rows: 2000, renderedRows: 25, showMs: 540, longTaskMs: 63 }

test('5回を順に測り、2回の外れ値を除いた中央値と全測定値を保存する', async () => {
  const values = [67, 900, 66, 800, 68]
  let calls = 0
  const result = await measureMedian(async () => ({ ...sample, pressMs: values[calls++] }))
  assert.equal(calls, 5)
  assert.equal(result.pressMs, 68)
  assert.deepEqual(result.samples.map(s => s.pressMs), values)
  assert.equal(median([NaN, Infinity, null]), null)
})

test('失敗した回を再試行で隠さず、過半数の欠測も失敗にする', async () => {
  let calls = 0
  await assert.rejects(measureMedian(async () => {
    if (++calls === 2) throw new Error('読込失敗')
    return sample
  }), /読込失敗/)
  assert.equal(calls, 2)
  calls = 0
  await assert.rejects(measureMedian(async () => ({ ...sample, showMs: ++calls > 2 ? null : 1000 })), /5回のうち2回/)
})

test('CI実測84ms・63msは補正後に通るが、2倍は全時間指標で落ちる', () => {
  const ci = speedPolicy('ci')
  assert.equal(ci.timeFactor, 1.3)
  assert.equal(ci.sampleCount, 5)
  assert.deepEqual(judge([{ ...sample, pressMs: 84 }], { inbox: base }, ci), [])
  assert.ok(judge([{ ...sample, pressMs: 84 }], { inbox: base }, speedPolicy('local')).length)
  assert.equal(assertStressTargets({ complete: true, measured: [stress] }, ci), stress)
  assert.throws(() => assertStressTargets({ complete: true, measured: [stress] }), /上限 50ms/)
  for (const metric of ['showMs', 'lcpMs', 'pressMs', 'longTaskMs']) {
    assert.equal(judge([{ ...sample, [metric]: base[metric] * 2 }], { inbox: base }, ci).length, 1, metric)
  }
  for (const change of [{ showMs: 2000 }, { longTaskMs: 100 }]) {
    assert.throws(() => assertStressTargets({ complete: true, measured: [{ ...stress, ...change }] }, ci), /上限/)
  }
})

test('補正の境界を守り、JS量とlongtaskの検出境界を時間倍率と混同しない', () => {
  const ci = speedPolicy('ci')
  assert.deepEqual(judge([{ ...sample, pressMs: 104 }], { inbox: base }, ci), [])
  assert.equal(judge([{ ...sample, pressMs: 105 }], { inbox: base }, ci).length, 1)
  assert.equal(judge([{ ...sample, jsBytes: base.jsBytes + 1025 }], { inbox: base }, ci).length, 1)
  assert.deepEqual(judge([{ ...sample, longTaskMs: 63 }], { inbox: { ...base, longTaskMs: 0 } }, ci), [])
  assert.equal(judge([{ ...sample, longTaskMs: 100 }], { inbox: { ...base, longTaskMs: 0 } }, ci).length, 1)
  assert.throws(() => speedPolicy('unlimited'), /未知/)
})

test('途中結果に速い2,000人があっても、未完了・エラー・欠測は合格にならない', () => {
  for (const extra of [{}, { complete: false }, { complete: true, error: 'settings: timeout' }]) {
    assert.throws(() => assertStressTargets({ measured: [{ ...stress, longTaskMs: 0 }], ...extra }), /未完了/)
    const report = speedReport({ measured: [stress], ...extra }, { budget: 'success', stress: 'success' })
    assert.equal(report.warning, true)
    assert.match(report.text, /測定未完了/)
  }
  for (const change of [{ longTaskMs: null }, { showMs: NaN }, { rows: 20 }, { renderedRows: 0 }]) {
    assert.throws(() => assertStressTargets({ complete: true, measured: [{ ...stress, ...change }] }, speedPolicy('ci')))
  }
  assert.match(speedReport({ complete: true }, { budget: 'failure', stress: 'success' }).text, /超過または判定失敗/)
})

test('CLIの測定不能は終了1・complete=false。報告は明示した警告と概要を残す', () => {
  const dir = mkdtempSync(join(tmpdir(), 'speed-controls-'))
  try {
    const result = join(dir, 'speed.json'), summary = join(dir, 'summary.md')
    const run = spawnSync(process.execPath, ['apps/web/scripts/v8-guard/speed-budget.mjs', 'http://127.0.0.1:1', result], { encoding: 'utf8', timeout: 30000, env: { ...process.env, V8_SPEED_PROFILE: 'ci' } })
    assert.equal(run.status, 1, run.stdout + run.stderr)
    const recorded = JSON.parse(readFileSync(result, 'utf8'))
    assert.equal(recorded.complete, false)
    assert.ok(recorded.error)
    const env = { ...process.env, GITHUB_STEP_SUMMARY: summary, SPEED_BUDGET_OUTCOME: 'failure', STRESS_SPEED_OUTCOME: 'failure' }
    const report = spawnSync(process.execPath, ['apps/web/scripts/v8-guard/speed-report.mjs', result], { encoding: 'utf8', env })
    assert.equal(report.status, 0)
    assert.match(report.stdout, /::warning::速度検査: 測定未完了/)
    assert.match(readFileSync(summary, 'utf8'), /測定未完了/)
    writeFileSync(result, '{broken')
    const broken = spawnSync(process.execPath, ['apps/web/scripts/v8-guard/speed-report.mjs', result], { encoding: 'utf8', env })
    assert.match(broken.stdout, /::warning::.*結果を読めません/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('速度だけ参考にし、必須レイアウトと生outcomeの警告を維持する', () => {
  const require = createRequire(new URL('../../../../apps/docs/package.json', import.meta.url))
  const { parse } = require('yaml')
  const workflow = parse(readFileSync(new URL('../../../../.github/workflows/required-pr-gate.yml', import.meta.url), 'utf8'))
  const guard = workflow.jobs['v8-screen-guard']
  assert.ok(!guard['continue-on-error'])
  assert.ok(workflow.jobs['required-pr-gate'].needs.includes('v8-screen-guard'))
  for (const script of ['layout-overflow.mjs', 'layout-defects.mjs', 'friends-table.browser.mjs']) {
    const step = guard.steps.find(s => s.run?.includes(script))
    assert.ok(step, script)
    assert.ok(!step['continue-on-error'], script)
  }
  for (const id of ['speed_budget', 'stress_speed']) {
    const step = guard.steps.find(s => s.id === id)
    assert.equal(step['continue-on-error'], true)
    assert.equal(step.env.V8_SPEED_PROFILE, 'ci')
  }
  const report = guard.steps.find(s => s.run?.includes('speed-report.mjs'))
  assert.match(report.if, /!cancelled\(\)/)
  assert.match(report.env.SPEED_BUDGET_OUTCOME, /speed_budget.outcome/)
  assert.match(report.env.STRESS_SPEED_OUTCOME, /stress_speed.outcome/)
  const perf3 = guard.steps.find(s => s.id === 'perf3_targets')
  assert.equal(perf3['continue-on-error'], true)
  assert.match(perf3.run, /perf3-targets.mjs/)
  assert.match(report.env.PERF3_TARGETS_OUTCOME, /perf3_targets.outcome/)
  const upload = guard.steps.find(s => s.name === 'Upload V8 screen guard results')
  assert.match(upload.if, /always\(\)/)
  assert.match(upload.with.path, /\/tmp\/v8-guard\//)
})


test('local-stubはAPI外のバージョン確認もCIと同じ固定応答にし、外部通信を残さない', async () => {
  const routes = new Map()
  const page = { route: async (pattern, answer) => routes.set(pattern, answer) }
  const paths = []
  await stubApi(page, async (method, path) => { paths.push([method, path]); return { status: 200, body: '{"version":"2.6.4"}' } })
  let fulfilled
  await routes.get('**/admin/**')({ request: () => ({ url: () => 'https://example.test/admin/version', method: () => 'GET', headers: () => ({ origin: 'http://127.0.0.1:4393' }) }), fulfill: async value => { fulfilled = value } })
  assert.deepEqual(paths, [['GET', '/admin/version']])
  assert.equal(fulfilled.status, 200)
  assert.equal(JSON.parse(fulfilled.body).version, '2.6.4')
  assert.equal(fulfilled.headers['Access-Control-Allow-Origin'], 'http://127.0.0.1:4393')
})
