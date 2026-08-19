import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MENU_SECTIONS, orderedMenuSections } from './menu'
import {
  DEFAULT_FEATURES,
  FEATURE_GROUPS,
  SIDEBAR_FEATURE_BY_HREF,
  groupEnabledCount,
  groupFeatureCount,
  itemIsEnabled,
  itemOrderFromGroups,
  moveItemWithinGroup,
  visibleFeatureGroups,
} from './feature-settings'

describe('機能設定とサイドメニューが同じ一覧を見る', () => {
  it('区分と項目がサイドメニューと1対1で対応する', () => {
    expect(FEATURE_GROUPS.map((group) => group.id)).toEqual(MENU_SECTIONS.map((section) => section.id))
    for (const [index, group] of FEATURE_GROUPS.entries()) {
      expect(group.items.map((item) => item.id)).toEqual(MENU_SECTIONS[index].items.map((item) => item.id))
    }
  })

  it('切り替えられない項目には鍵を付け、常に有効として扱う', () => {
    const basic = FEATURE_GROUPS.find((group) => group.id === 'basic')!
    expect(basic.items.every((item) => item.required && itemIsEnabled(item, {}))).toBe(true)
    // 消せない項目しか無い区分は「0機能」と数える。スイッチが無いため。
    expect(groupFeatureCount(basic)).toBe(0)
  })

  it('区分ごとの有効数を数える', () => {
    const delivery = FEATURE_GROUPS.find((group) => group.id === 'delivery')!
    expect(groupFeatureCount(delivery)).toBe(6)
    // ウェビナーだけ初期オフ。
    expect(groupEnabledCount(delivery, DEFAULT_FEATURES)).toBe(5)
  })

  it('V2どおりウェビナーと成果アフィリエイトを初期オフにする', () => {
    expect(DEFAULT_FEATURES.webinars).toBe(false)
    expect(DEFAULT_FEATURES.affiliates).toBe(false)
    expect(DEFAULT_FEATURES.nen_campaigns).toBe(true)
    expect(DEFAULT_FEATURES.photo_review).toBe(true)
    expect(DEFAULT_FEATURES.ec_commerce).toBe(true)
  })

  it('サイドメニューにある切り替え可能な項目には、必ずキーがある', () => {
    // キーが無い項目はオフにできない。「機能設定に並んでいるのに切り替わらない」
    // という形で表に出るので、ここで気づけるようにする。
    for (const section of MENU_SECTIONS) {
      for (const item of section.items) {
        expect(item.required === true || Boolean(item.featureKey)).toBe(true)
      }
    }
  })

  it('専門設計カタログにある項目だけを専用機能に出す', () => {
    const groups = visibleFeatureGroups({ specializedFeatureKeys: ['photo_review'] })
    const specialized = groups.find((group) => group.id === 'specialized')!
    expect(specialized.items.map((item) => item.id)).toEqual(['photo-review'])

    const withoutDesign = visibleFeatureGroups({ specializedFeatureKeys: [] })
    expect(withoutDesign.some((group) => group.id === 'specialized')).toBe(false)
  })

  it('画面のスイッチとサイドメニュー項目が対応している', () => {
    expect(SIDEBAR_FEATURE_BY_HREF['/scenarios']).toBe('scenarios')
    expect(SIDEBAR_FEATURE_BY_HREF['/webinars']).toBe('webinars')
    expect(SIDEBAR_FEATURE_BY_HREF['/nen-members']).toBe('photo_review')
    expect(SIDEBAR_FEATURE_BY_HREF['/ec-commerce']).toBe('ec_commerce')
    // 前は受け口が無く、オフにしてもメニューから消えなかったもの。
    expect(SIDEBAR_FEATURE_BY_HREF['/friend-add-settings']).toBe('friend_add_routing')
    expect(SIDEBAR_FEATURE_BY_HREF['/contents']).toBe('media')
    expect(SIDEBAR_FEATURE_BY_HREF['/analytics']).toBe('analytics')
    expect(SIDEBAR_FEATURE_BY_HREF['/automations']).toBe('automations')
    expect(SIDEBAR_FEATURE_BY_HREF['/webhooks']).toBe('external_integrations')
    expect(SIDEBAR_FEATURE_BY_HREF['/events']).toBe('events')
    expect(SIDEBAR_FEATURE_BY_HREF['/booking/bookings']).toBe('booking')
  })
})

describe('並び替え', () => {
  it('区分の中だけで入れ替える', () => {
    const ids = ['a', 'b', 'c']
    expect(moveItemWithinGroup(ids, 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveItemWithinGroup(ids, 'b', 1)).toEqual(['a', 'c', 'b'])
  })

  it('端では動かさない', () => {
    const ids = ['a', 'b', 'c']
    expect(moveItemWithinGroup(ids, 'a', -1)).toEqual(ids)
    expect(moveItemWithinGroup(ids, 'c', 1)).toEqual(ids)
    expect(moveItemWithinGroup(ids, 'z', 1)).toEqual(ids)
  })

  it('保存した並びをサイドメニューに当てる', () => {
    const basic = MENU_SECTIONS.find((section) => section.id === 'basic')!
    const reversed = [...basic.items.map((item) => item.id)].reverse()
    const applied = orderedMenuSections({ basic: reversed })
    expect(applied.find((section) => section.id === 'basic')!.items.map((item) => item.id)).toEqual(reversed)
    // ほかの区分は動かない。
    const delivery = MENU_SECTIONS.find((section) => section.id === 'delivery')!
    expect(applied.find((section) => section.id === 'delivery')!.items.map((item) => item.id))
      .toEqual(delivery.items.map((item) => item.id))
  })

  it('保存に無い項目は消さずに後ろへ残す', () => {
    const basic = MENU_SECTIONS.find((section) => section.id === 'basic')!
    const partial = [basic.items[2].id]
    const applied = orderedMenuSections({ basic: partial })
    const ids = applied.find((section) => section.id === 'basic')!.items.map((item) => item.id)
    expect(ids[0]).toBe(basic.items[2].id)
    expect(ids).toHaveLength(basic.items.length)
  })

  it('いまの並びをそのまま保存の形にできる', () => {
    const order = itemOrderFromGroups(FEATURE_GROUPS)
    expect(order.basic).toEqual(FEATURE_GROUPS.find((group) => group.id === 'basic')!.items.map((item) => item.id))
  })
})

describe('保存の受け口', () => {
  /**
   * 画面が使うキーを、サーバーが1つ残らず受け付けること。
   *
   * サーバーは知らないキーを 400 で弾く。片方にだけキーを足すと、
   * スイッチは動くのに保存だけ落ちる（画面には「保存できませんでした」としか
   * 出ない）。実際に、友だち追加時の配信・コンテンツ・分析・自動化・予約は
   * 受け口が無いままメニューに並んでいた。
   */
  it('worker の TOGGLEABLE_FEATURES が、画面の使うキーを全部含む', () => {
    const workerSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'worker', 'src', 'routes', 'feature-settings.ts'),
      'utf8',
    )
    const start = workerSource.indexOf('export const TOGGLEABLE_FEATURES = [')
    const end = workerSource.indexOf('] as const;', start)
    const accepted = new Set(
      [...workerSource.slice(start, end).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
    )
    const used = MENU_SECTIONS.flatMap((section) =>
      section.items.map((item) => item.featureKey).filter((key): key is NonNullable<typeof key> => Boolean(key)),
    )
    expect([...new Set(used)].filter((key) => !accepted.has(key))).toEqual([])
  })
})
