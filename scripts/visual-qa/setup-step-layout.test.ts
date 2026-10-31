import { expect, it } from 'vitest'
import { setupStepLayoutFailures } from './setup-step-layout.mjs'
const valid = () => ({ width: 800, gap: 8, rows: [{ width: 800, height: 60, overflow: 0, labelOverflow: 0 }] })
it('共通の高さとすき間なら通る', () => {
  expect(setupStepLayoutFailures([valid(), valid()])).toEqual([])
})
it('すき間がなくなる故障を検出する', () => {
  expect(setupStepLayoutFailures([{ ...valid(), gap: 0 }])).toContain('setup step rows need at least 8px gap')
})
it('幅0・小さな行・横にはみ出す故障を検出する', () => {
  const failures = setupStepLayoutFailures([{ ...valid(), width: 0, rows: [{ width: 0, height: 40, overflow: 20, labelOverflow: 0 }] }])
  expect(failures).toEqual(['setup step list has collapsed', 'setup step row is too small', 'setup step row overflows'])
})

it('短い手順名の切れも検出する', () => {
  const list = valid()
  list.rows[0].labelOverflow = 30
  expect(setupStepLayoutFailures([list])).toContain('setup step label is clipped')
})

it('未確認の理由が手順名から離れたら検出する', () => {
  const row = { ...valid().rows[0], helpGap: 8 }
  expect(setupStepLayoutFailures([{ ...valid(), rows: [row] }])).toEqual([])
  expect(setupStepLayoutFailures([{ ...valid(), rows: [{ ...row, helpGap: 80 }] }])).toContain('setup step help is detached from its label')
})
