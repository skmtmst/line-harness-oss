import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SavedSegmentPreset } from '@line-crm/shared'
import { conditionFromSegmentPreset } from './segment-preset'

const here = dirname(fileURLToPath(import.meta.url))
const controls = readFileSync(join(here, 'segment-preset-controls.tsx'), 'utf8')
const form = readUiSource(join(here, 'broadcast-form.tsx'), 'utf8')

/*
 * 保存した対象条件の読み書き・状態の出し分け・アカウント切替・数の「—」・押せない理由は、
 * segment-preset-controls-react.test.tsx が部品を押して見る。ここは純粋な関数と禁止の見張りだけ。
 */
describe('一斉配信で保存した対象条件を再利用する', () => {
  it('keeps the saved condition independent from later edits', () => {
    const preset = {
      id: 'preset-1',
      name: '反応した友だち',
      scope: 'friends',
      conditionFormat: 'segment_v1',
      conditions: {
        version: 1,
        condition: {
          operator: 'AND',
          rules: [{ type: 'support_mark', value: { markIds: ['mark-1'], exclude: false } }],
          groups: [],
        },
      },
      createdBy: 'staff-1',
      lineAccountId: 'account-1',
      isShared: true,
      displayOrder: 0,
      createdAt: '2026-08-29T00:00:00.000Z',
    } satisfies SavedSegmentPreset

    const condition = conditionFromSegmentPreset(preset)
    const value = condition.rules[0].value as { markIds: string[] }
    value.markIds[0] = 'mark-2'

    expect(preset.conditions.condition.rules[0].value).toEqual({ markIds: ['mark-1'], exclude: false })
  })

  it('does not use the old saved-search conversion', () => {
    expect(controls).not.toContain('api.savedSearches')
    expect(controls).not.toContain('SearchConditions')
  })

  it('does not leave the prepared buttons in the form', () => {
    expect(form).not.toContain('条件の保存は準備中です')
    expect(form).not.toContain('保存した条件は準備中です')
  })
})

describe('保存した対象条件のKPI（sqFXf）', () => {
  it('取れない数を作り値で埋めない', () => {
    // 数の代わりに出すのは「—」だけ。0件・0人・作った割合を置かない。
    expect(controls).not.toMatch(/PRESET_KPIS[\s\S]*?value:\s*\d/)
  })
})
