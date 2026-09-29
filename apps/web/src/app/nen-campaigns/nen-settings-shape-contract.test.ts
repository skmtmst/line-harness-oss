/*
 * NEN設定の4者の形(#728)。重大1(編集画面の型ずれ)の再発防止。
 *
 * 画面が受け取る型・実口が返す形・モックが返す形・見本の形が揃っていること。
 * 単語の有無ではなく、鍵の集合の一致で見る。1つでもずれたら赤になる。
 * 4者のうち1つを壊す逆変異で、対応する表明が赤になることを確かめてある。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { NEN_CAMPAIGN_SETTINGS } from '../../../../../scripts/visual-qa/fixtures.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')
const read = (relative: string): string => readFileSync(path.join(repoRoot, relative), 'utf8')

function sortedKeys(values: Iterable<string>): string[] {
  return [...new Set(values)].sort()
}

/** 画面が受け取る型 NenCampaignSetting の鍵。 */
function typeKeys(): string[] {
  const source = read('apps/web/src/lib/api.ts')
  const block = source.match(/export type NenCampaignSetting = \{([\s\S]*?)\n\}/)
  if (!block) throw new Error('NenCampaignSetting が見つかりません')
  return sortedKeys(
    [...block[1].matchAll(/^  (\w+)\??:/gm)].map((found) => found[1]),
  )
}

/** 実口 GET /api/nen-campaigns/settings が返す形の鍵。 */
function workerKeys(): string[] {
  const source = read('apps/worker/src/routes/nen-campaigns.ts')
  const block = source.match(/settings\.map\(\(row\) => \(\{([\s\S]*?)\}\)\) \}\);/)
  if (!block) throw new Error('settings の組み立てが見つかりません')
  return sortedKeys(
    [...block[1].matchAll(/^    (\w+): row\./gm)].map((found) => found[1]),
  )
}

/** 見本の1件ぶんの鍵。 */
function fixtureKeys(): string[][] {
  const items = NEN_CAMPAIGN_SETTINGS as Array<Record<string, unknown>>
  if (items.length === 0) throw new Error('見本が空です')
  return items.map((item) => sortedKeys(Object.keys(item)))
}

/** 型 NenCampaignAfterAction の kind の取りうる値。 */
function typeActionKinds(): string[] {
  const source = read('apps/web/src/lib/api.ts')
  const block = source.match(/export type NenCampaignAfterAction =([\s\S]*?)\n\nexport type/)
  if (!block) throw new Error('NenCampaignAfterAction が見つかりません')
  return sortedKeys(
    [...block[1].matchAll(/kind: '([^']+)'/g)].map((found) => found[1]),
  )
}

describe('NEN設定の4者の形(#728)', () => {
  it('画面の型と実口の鍵が一致する', () => {
    expect(workerKeys()).toEqual(typeKeys())
  })

  it('見本の全件が画面の型と同じ鍵を持つ', () => {
    const expected = typeKeys()
    for (const keys of fixtureKeys()) {
      expect(keys).toEqual(expected)
    }
  })

  it('モックは見本そのものを返す', () => {
    const source = read('scripts/visual-qa/mock-api.mjs')
    const line = source
      .split('\n')
      .find((text) => text.includes('/api/nen-campaigns/settings'))
    if (!line) throw new Error('モックの設定口が見つかりません')
    expect(line).toContain('NEN_CAMPAIGN_SETTINGS')
  })

  it('afterActions の種類が型と見本で一致する', () => {
    const kinds = typeActionKinds()
    const seen = sortedKeys(
      (NEN_CAMPAIGN_SETTINGS as Array<{ afterActions?: Array<{ kind: string }> }>)
        .flatMap((item) => item.afterActions ?? [])
        .map((action) => action.kind),
    )
    expect(seen).toEqual(kinds)
  })

  it('review_request は2種類の後続動作を持つ', () => {
    const review = (NEN_CAMPAIGN_SETTINGS as Array<{
      campaignKey: string
      afterActions?: Array<{ kind: string }>
    }>).find((item) => item.campaignKey === 'review_request')
    if (!review) throw new Error('見本に review_request がありません')
    expect(sortedKeys((review.afterActions ?? []).map((action) => action.kind)))
      .toEqual(['award_mileage', 'open_form'])
  })
})
