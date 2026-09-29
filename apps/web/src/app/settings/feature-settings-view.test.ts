import { FEATURE_CATALOG, FEATURE_IDS } from '@line-crm/shared'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FeatureGroup } from '@/lib/feature-settings'
import {
  CATALOG_DEFAULT_FEATURES,
  FEATURE_SETTINGS_CONFLICT_MESSAGE,
  applyItemOrder,
  featureSettingsAreDirty,
  featureSettingsErrorMessage,
  normalizeFeatureSettings,
  splitFeatureGroups,
} from './feature-settings-view'

const groups: FeatureGroup[] = [
  { id: 'a', label: 'A', items: [{ id: 'a1', label: 'A1', note: '', keys: ['scenarios'] }] },
  { id: 'b', label: 'B', items: [
    { id: 'b1', label: 'B1', note: '', keys: ['broadcasts'] },
    { id: 'b2', label: 'B2', note: '', keys: ['templates'] },
  ] },
  { id: 'c', label: 'C', items: [{ id: 'c1', label: 'C1', note: '', keys: ['forms'] }] },
]

describe('機能設定の画面契約', () => {
  it('共有カタログの全キーと既定値だけを画面状態にする', () => {
    expect(Object.keys(CATALOG_DEFAULT_FEATURES)).toEqual(FEATURE_IDS)
    expect(normalizeFeatureSettings({ scenarios: false, unknown: true })).toEqual({
      ...CATALOG_DEFAULT_FEATURES,
      scenarios: false,
    })
    for (const entry of FEATURE_CATALOG) {
      expect(CATALOG_DEFAULT_FEATURES[entry.featureId]).toBe(entry.defaultEnabled)
    }
  })

  it('表示順と変更判定が同じ並び定義を見る', () => {
    const ordered = applyItemOrder(groups, { b: ['b2', 'b1'] })
    expect(ordered[1].items.map((item) => item.id)).toEqual(['b2', 'b1'])
    expect(featureSettingsAreDirty({
      savedFeatures: CATALOG_DEFAULT_FEATURES,
      features: CATALOG_DEFAULT_FEATURES,
      savedOrder: { b: ['b1', 'b2'] },
      currentOrder: { b: ['b2', 'b1'] },
    })).toBe(true)
  })

  it('カタログ由来の区分を手書きIDなしで列へ分ける', () => {
    expect(splitFeatureGroups(groups, 2).flat()).toEqual(groups)
    expect(splitFeatureGroups(groups, 2)).toHaveLength(2)
  })

  it('変更なし・409・403で次の行動が分かる', () => {
    expect(featureSettingsAreDirty({
      savedFeatures: CATALOG_DEFAULT_FEATURES,
      features: { ...CATALOG_DEFAULT_FEATURES },
      savedOrder: {},
      currentOrder: {},
    })).toBe(false)
    expect(FEATURE_SETTINGS_CONFLICT_MESSAGE).toContain('最新の状態を読み直した')
    expect(featureSettingsErrorMessage(403, 'load')).toContain('見る権限')
    expect(featureSettingsErrorMessage(403, 'save')).toContain('変更する権限')
  })

  it('撮影用の機能設定も本物と同じ版・全キー・既定オフを返す', () => {
    const mock = readFileSync(resolve(process.cwd(), '../../scripts/visual-qa/mock-api.mjs'), 'utf8')
    const featureSection = mock.slice(mock.indexOf('const FEATURES = {'), mock.indexOf('/** 設計 `bfB50`'))
    for (const { featureId } of FEATURE_CATALOG) expect(featureSection).toContain(`${featureId}:`)
    for (const { featureId } of FEATURE_CATALOG.filter((item) => !item.defaultEnabled)) {
      expect(featureSection).toContain(`${featureId}: false`)
    }
    expect(mock.slice(mock.indexOf("'/api/settings/features':"))).toContain('version: 1')
  })

  it('マニュアル一覧の固定件数は固定行数と一致する', () => {
    const fixtures = readFileSync(resolve(process.cwd(), '../../scripts/visual-qa/fixtures.mjs'), 'utf8')
    const start = fixtures.indexOf('export const MANUAL_LINKS')
    const section = fixtures.slice(start, fixtures.indexOf('const booking', start))
    expect(section.match(/key: '[^']+'/g)).toHaveLength(5)
    expect(section).toContain('total: 5')
  })
})
