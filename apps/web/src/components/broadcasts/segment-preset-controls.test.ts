import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SavedSegmentPreset } from '@line-crm/shared'
import { conditionFromSegmentPreset } from './segment-preset'

const here = dirname(fileURLToPath(import.meta.url))
const controls = readFileSync(join(here, 'segment-preset-controls.tsx'), 'utf8')
const form = readFileSync(join(here, 'broadcast-form.tsx'), 'utf8')

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

  it('loads and saves only the segment_v1 API without the old search conversion', () => {
    expect(controls).toContain('api.segmentPresets.list(accountId)')
    expect(controls).toContain('api.segmentPresets.create({')
    expect(controls).not.toContain('api.savedSearches')
    expect(controls).not.toContain('SearchConditions')
  })

  it('distinguishes loading, empty, and failed states', () => {
    expect(controls).toContain('<ListState kind="loading"')
    expect(controls).toContain('kind="error"')
    expect(controls).toContain('kind="empty"')
    expect(controls).toContain('保存した条件を表示できませんでした')
  })

  it('replaces both prepared buttons with working controls', () => {
    expect(form).toContain('<SegmentPresetControls')
    expect(form).not.toContain('条件の保存は準備中です')
    expect(form).not.toContain('保存した条件は準備中です')
    expect(controls).toContain('data-design-node="cPk8A"')
    expect(controls).toContain('data-design-node="sqFXf"')
  })
})
