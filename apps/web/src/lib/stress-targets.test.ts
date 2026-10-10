import { expect, it } from 'vitest'
// @ts-expect-error Browser measurement CLI
import { assertStressTargets } from '../../scripts/v8-guard/stress-targets.mjs'

const sample = { name: 'friends-2000', rows: 2000, renderedRows: 25, showMs: 800, longTaskMs: 0 }
it('1秒・50msの目標をCIで守り、欠測を0と扱わない', () => {
  expect(assertStressTargets({ measured: [sample] })).toEqual(sample)
  for (const change of [{ showMs: 1001 }, { longTaskMs: 51 }, { longTaskMs: null }, { showMs: null }, { rows: 20 }, { renderedRows: 0 }]) {
    expect(() => assertStressTargets({ measured: [{ ...sample, ...change }] })).toThrow()
  }
  expect(() => assertStressTargets({ measured: [] })).toThrow()
})
