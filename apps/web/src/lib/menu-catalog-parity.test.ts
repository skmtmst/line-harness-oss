import { describe, expect, it } from 'vitest'
import { MENU_SECTION_CATALOG } from '@line-crm/shared'
import { MENU_SECTIONS } from './menu'

/*
 * menu.ts の区分・項目は、共有カタログ（packages/shared/src/menu-catalog.ts）
 * と完全一致でなければならない。
 *
 * サーバーは保存される並び順を共有カタログの完全な顔ぶれで検査する
 * （N-441）。ここにだけ項目を足すと、その項目を含む保存が全部400に
 * なる。追加・削除・改名は共有カタログとセットで行う。
 */
describe('menu catalog parity', () => {
  it('区分のid・見出し・並びが共有カタログと一致する', () => {
    expect(
      MENU_SECTIONS.map((section) => ({
        id: section.id,
        label: section.label,
        title: section.title,
      })),
    ).toEqual(
      MENU_SECTION_CATALOG.map((section) => ({
        id: section.id,
        label: section.label,
        title: section.title,
      })),
    )
  })

  it('各区分の項目のid・featureKey・required・並びが共有カタログと一致する', () => {
    for (const catalogSection of MENU_SECTION_CATALOG) {
      const section = MENU_SECTIONS.find((candidate) => candidate.id === catalogSection.id)
      expect(section, `区分 ${catalogSection.id}`).toBeDefined()
      expect(
        section!.items.map((item) => ({
          id: item.id,
          featureKey: item.featureKey,
          required: item.required === true || undefined,
        })),
      ).toEqual(
        catalogSection.items.map((item) => ({
          id: item.id,
          featureKey: item.featureKey,
          required: item.required === true || undefined,
        })),
      )
    }
  })
})
