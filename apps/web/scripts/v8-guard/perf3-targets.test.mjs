import test from 'node:test'
import assert from 'node:assert/strict'
import { assertPerf3Targets } from './perf3-targets.mjs'
import { speedReport } from './speed-report.mjs'
const result = () => ({ complete: true, results: [
  { name: 'tags', diagnostic: false, samples: [900, 1000, 1100].map(showMs => ({ showMs })) },
  { name: 'friends-2000', diagnostic: false, samples: [50, 65, 80].map(longTaskMs => ({ longTaskMs, rows: 2000, renderedRows: 25 })) },
] })
test('実測の中央値と固定上限を使い、タグ超過・長い処理超過を検出する', () => {
  assert.doesNotThrow(() => assertPerf3Targets(result()))
  for (const [index, key, value] of [[0, 'showMs', 1001], [1, 'longTaskMs', 66]]) {
    const slow = result()
    slow.results[index].samples.forEach(s => { s[key] = value })
    assert.throws(() => assertPerf3Targets(slow), /上限/)
  }
})
test('欠測・2回だけ・不足応答・診断だけを合格にしない', () => {
  for (const corrupt of [r => { r.complete = false }, r => { r.results[0].samples[0].showMs = null }, r => { r.results[0].samples.pop() }, r => { r.results[1].samples[0].rows = 20 }, r => { r.results[1].diagnostic = true }]) {
    const incomplete = result(); corrupt(incomplete)
    assert.throws(() => assertPerf3Targets(incomplete))
  }
})
test('既存CIの5回測定をそのまま読み、中央値の転記や時間倍率を使わない', () => {
 const standard = { complete: true, measured: result().results.map(r => ({ ...r, samples: [...r.samples, ...r.samples.slice(0,2)] })) }
 assert.doesNotThrow(() => assertPerf3Targets(standard))
 standard.measured[0].samples.forEach(s => { s.showMs = 1001 })
 assert.throws(() => assertPerf3Targets(standard), /上限1000ms/)
})
test('従来の予算が通ってもPERF-01の失敗・未実行はActionsの概要で合格にしない', () => {
 for (const perf3 of ['failure', 'skipped', undefined]) {
  const report = speedReport({ complete: true }, { budget: 'success', stress: 'success', perf3 })
  assert.equal(report.warning, true)
  assert.match(report.text, /超過または判定失敗.*PERF-01=/)
 }
 const passed = speedReport({ complete: true }, { budget: 'success', stress: 'success', perf3: 'success' })
 assert.equal(passed.warning, false)
 assert.match(passed.text, /タグ1秒・長い処理65ms/)
})
