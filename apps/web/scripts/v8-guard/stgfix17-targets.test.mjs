import test from 'node:test'
import assert from 'node:assert/strict'
import { assertStgfix17Targets } from './stgfix17-targets.mjs'

const fixture = () => ({ complete: true, measured: ['dashboard', 'broadcasts', 'broadcast-new', 'friends-2000'].map(name => ({ name, showMs: 1000, longTaskMs: 50, samples: Array.from({length: 5}, () => ({ showMs: 1000, longTaskMs: 50, rows: 2000, renderedRows: 20 })) })) })
test('元の4目標は境界値で通り、各項目を1ms壊すと落ちる', () => {
  assert.doesNotThrow(() => assertStgfix17Targets(fixture()))
  for (const [name, metric] of [['dashboard','showMs'],['broadcasts','longTaskMs'],['broadcast-new','longTaskMs'],['friends-2000','longTaskMs']]) {
    const result = fixture(), row = result.measured.find(m => m.name === name)
    row[metric]++
    row.samples.forEach(s => s[metric]++)
    assert.throws(() => assertStgfix17Targets(result), /上限/)
  }
})
test('未完了・欠測・予定だけの2,000件・偽の中央値では通さない', () => {
  for (const breakIt of [r => {r.complete=false}, r => {r.measured[0].samples.pop()}, r => {r.measured[1].samples[0].longTaskMs=null}, r => {r.measured[3].samples[0].rows=1999}, r => {r.measured[3].samples[0].renderedRows=0}, r => {r.measured[0].showMs=1}]) {
    const result=fixture();breakIt(result);assert.throws(() => assertStgfix17Targets(result))
  }
})
