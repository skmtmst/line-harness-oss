import { describe, expect, it } from 'vitest'
import { FEATURE_CATALOG, FEATURE_IDS, type FeatureId } from '@line-crm/shared'
import {
  FEATURE_PRESETS,
  FEATURE_SET_LABELS,
  FEATURE_SET_NOTES,
  featureSetEntry,
  presetApplyReason,
  presetFeatureMap,
  presetTurnsOff,
  presetTurnsOn,
} from './feature-presets'

/**
 * IDEA-31「初回案内で業種・担当業務に合う既存機能の初期セットを選ぶ」の
 * 契約を文言ごと固定する。
 *
 * ここで守りたいのは 3 点——
 * 1. どのセットでも順路（段3・段4）に必要な機能は残る
 * 2. セットはカタログ全機能を必ず網羅する（書き漏れで中途半端な設定にならない）
 * 3. 保存済みの設定がある画面では選ばせない（既存設定をリセットしない）
 */

const CATALOG_IDS = new Set<FeatureId>(FEATURE_IDS)

describe('初期セットの定義', () => {
  it('3つのセットが決まった順で並ぶ', () => {
    expect(FEATURE_PRESETS.map((preset) => preset.id)).toEqual(['starter', 'booking', 'all'])
  })

  it('どのセットにも業種・担当業務の説明がある', () => {
    for (const preset of FEATURE_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0)
      expect(preset.audience.length).toBeGreaterThan(0)
    }
  })

  it('どのセットでも順路に必要な機能（振り分け・シナリオ・テンプレート）は残る', () => {
    for (const preset of FEATURE_PRESETS) {
      for (const required of ['friend_add_routing', 'scenarios', 'templates'] as const) {
        expect(preset.enables, `${preset.id} は ${required} を残す`).toContain(required)
      }
    }
  })

  it('セットに挙げるのはカタログにある機能だけ', () => {
    for (const preset of FEATURE_PRESETS) {
      for (const id of preset.enables) {
        expect(CATALOG_IDS.has(id), `${preset.id} に知らない機能: ${id}`).toBe(true)
      }
      // 重複があると「オンにしたはずの個数」がずれる
      expect(new Set(preset.enables).size).toBe(preset.enables.length)
    }
  })

  it('検証用の飲食店向け機能はどのセットにも含めない', () => {
    for (const preset of FEATURE_PRESETS) {
      expect(preset.enables).not.toContain('restaurant_test')
    }
  })
})

describe('セットを保存用の表にする', () => {
  it('カタログ全機能を必ず網羅し、セットに無い機能はオフになる', () => {
    for (const preset of FEATURE_PRESETS) {
      const map = presetFeatureMap(preset)
      expect(Object.keys(map).sort()).toEqual([...FEATURE_IDS].sort())
      const on = new Set(preset.enables)
      for (const id of FEATURE_IDS) {
        expect(map[id]).toBe(on.has(id))
      }
    }
  })

  it('「全部の機能を使う」は検証用を除く全部をオンにする', () => {
    const all = FEATURE_PRESETS.find((preset) => preset.id === 'all')!
    const map = presetFeatureMap(all)
    for (const entry of FEATURE_CATALOG) {
      expect(map[entry.featureId]).toBe(entry.featureId !== 'restaurant_test')
    }
  })
})

describe('適用前の増減の説明', () => {
  const current = Object.fromEntries(FEATURE_IDS.map((id) => [id, true])) as Record<string, boolean>

  it('いまオンの機能でセットに無いものが「非表示になる」側に数えられる', () => {
    const starter = FEATURE_PRESETS.find((preset) => preset.id === 'starter')!
    const off = presetTurnsOff(starter, current)
    expect(off.length).toBe(FEATURE_IDS.length - starter.enables.length)
    expect(off).toContain('booking')
    expect(off).not.toContain('scenarios')
  })

  it('いまオフの機能でセットに含まれるものが「新しく表示される」側に数えられる', () => {
    const all = FEATURE_PRESETS.find((preset) => preset.id === 'all')!
    // 既定では webinars / affiliates / multi_store_hierarchy がオフ
    const defaults = Object.fromEntries(
      FEATURE_CATALOG.map((entry) => [entry.featureId, entry.defaultEnabled]),
    ) as Record<string, boolean>
    const on = presetTurnsOn(all, defaults)
    expect(on.sort()).toEqual(['affiliates', 'multi_store_hierarchy', 'webinars'].sort())
  })

  it('変わらないセットは増減0と数える', () => {
    const starter = FEATURE_PRESETS.find((preset) => preset.id === 'starter')!
    const map = presetFeatureMap(starter)
    expect(presetTurnsOff(starter, map)).toHaveLength(0)
    expect(presetTurnsOn(starter, map)).toHaveLength(0)
  })
})

describe('この画面で選べるかの判定', () => {
  it('まだ保存していないアカウント（version 0）だけが選べる', () => {
    expect(featureSetEntry({ forbidden: false, version: 0 }).kind).toBe('picker')
  })

  it('保存済みの設定がある（version 1 以上）ときは選ばせない', () => {
    expect(featureSetEntry({ forbidden: false, version: 3 }).kind).toBe('configured')
  })

  it('権限が無い人には picker を出さない', () => {
    expect(featureSetEntry({ forbidden: true, version: 0 }).kind).toBe('forbidden')
  })
})

describe('説明文と案内', () => {
  it('非表示と実行停止の違いを説明する文がある', () => {
    expect(FEATURE_SET_NOTES.length).toBeGreaterThanOrEqual(3)
    const joined = FEATURE_SET_NOTES.join('\n')
    // 「隠す」ことと「止める」ことを混同させない
    expect(joined).toContain('消えます')
    expect(joined).toContain('止まりません')
    // 緊急停止は別の画面（運用状態）にあることを言う
    expect(joined).toContain('運用状態')
  })

  it('変更理由に選んだセット名が入る（監査に残る）', () => {
    const preset = FEATURE_PRESETS[0]
    expect(presetApplyReason(preset)).toContain(preset.label)
  })

  it('禁止文言を使わない', () => {
    const all = [
      ...FEATURE_SET_NOTES,
      ...Object.values(FEATURE_SET_LABELS).filter((v): v is string => typeof v === 'string'),
      ...FEATURE_PRESETS.flatMap((preset) => [preset.label, preset.audience]),
    ].join('\n')
    expect(all).not.toContain('準備中')
  })
})
