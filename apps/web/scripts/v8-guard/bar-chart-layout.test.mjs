import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assessBarChartLayout } from './bar-chart-layout-browser.mjs'

const chart = () => ({ line: 100, legendPresent: true, bars: [
  { series: 'added', top: 40, bottom: 100, height: 60 },
  { series: 'removed', top: 100, bottom: 120, height: 20 },
  { series: 'removed', top: 100, bottom: 100, height: 0 },
], colors: { added: 'green', removed: 'gray', broadcast: 'blue', scenario: 'purple' },
  events: [{ kind: 'broadcast', color: 'blue' }, { kind: 'scenario', color: 'purple' }] })

test('基準線上下と凡例どおりの出来事は通る', () => {
  assert.equal(assessBarChartLayout(chart()), 0)
})
test('減少が基準線の上に戻ると落ちる', () => {
  const measured = chart()
  measured.bars[1] = { series: 'removed', top: 80, bottom: 100, height: 20 }
  assert.equal(assessBarChartLayout(measured), 1)
})
test('増加と配信日が同じ色へ戻ると落ちる', () => {
  const measured = chart()
  measured.colors.broadcast = 'green'
  measured.events[0].color = 'green'
  assert.equal(assessBarChartLayout(measured), 1)
})
test('日付の印だけが凡例と食い違うと落ちる', () => {
  const measured = chart()
  measured.events[0].color = 'purple'
  assert.equal(assessBarChartLayout(measured), 1)
})

test('凡例を見つけられない測定を0へしない', () => {
  const measured = chart()
  measured.legendPresent = false
  assert.equal(assessBarChartLayout(measured), 1)
})

test('色の変数が出力されず印が透明になったら落ちる', () => {
  const measured = chart()
  measured.colors.broadcast = 'rgba(0, 0, 0, 0)'
  measured.events[0].color = 'rgba(0, 0, 0, 0)'
  assert.equal(assessBarChartLayout(measured), 2)
})
