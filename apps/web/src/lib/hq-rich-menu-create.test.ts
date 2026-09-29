import { describe, expect, it } from 'vitest'
import type { RichMenuDefinition } from './hq-templates-api'
import {
  HqRichMenuCompatibilityError,
  hqDefinitionToRichMenuCreateValue,
  richMenuCreateValueToHqDefinition,
} from './hq-rich-menu-create'

function definition(): RichMenuDefinition {
  return {
    schemaVersion: 1,
    richMenu: {
      id: 'menu',
      name: 'メイン',
      chatBarText: 'メニュー',
      size: 'large',
      defaultPageId: 'page-1',
      pages: [
        {
          id: 'page-1',
          name: 'トップ',
          imageR2Key: 'hq-templates/tenant/menu.png',
          areas: [
            { id: 'left', bounds: { x: 0, y: 0, width: 1250, height: 1686 }, actionType: 'uri', actionData: { uri: 'https://example.com' }, intent: 'url', label: '商品', tagIds: ['tag-1'] },
            { id: 'right', bounds: { x: 1250, y: 0, width: 1250, height: 1686 }, actionType: 'postback', actionData: {}, intent: 'template', label: '案内', templateId: 'template-1' },
          ],
        },
        { id: 'page-2', name: '次', imageR2Key: 'hq-templates/tenant/sub.png', areas: [] },
      ],
    },
  }
}

describe('HQリッチメニュー共通作成UI変換', () => {
  it('既存の複数ページと参照を落とさず往復する', () => {
    const source = definition()
    const draft = hqDefinitionToRichMenuCreateValue(source)
    const converted = richMenuCreateValueToHqDefinition({ ...draft, name: '更新後' }, source)
    expect(converted.richMenu.name).toBe('更新後')
    expect(converted.richMenu.pages[0].areas).toEqual(source.richMenu.pages[0].areas)
    expect(converted.richMenu.pages[1]).toEqual(source.richMenu.pages[1])
    expect(converted.richMenu.defaultPageId).toBe('page-1')
  })

  it('店舗固有の計測リンクを黙って落とさない', () => {
    const source = definition()
    const draft = hqDefinitionToRichMenuCreateValue(source)
    const areas = draft.areaDraftsByTemplate[draft.templateKey]
    expect(() => richMenuCreateValueToHqDefinition({
      ...draft,
      areaDraftsByTemplate: { ...draft.areaDraftsByTemplate, [draft.templateKey]: [{ ...areas[0], trackedLinkId: 'store-link' }, ...areas.slice(1)] },
    }, source)).toThrow(HqRichMenuCompatibilityError)
  })

  it('シナリオ参照と自由配置は内容を変更せず停止する', () => {
    const source = definition()
    source.richMenu.pages[0].areas[0].scenarioId = 'scenario-1'
    expect(() => hqDefinitionToRichMenuCreateValue(source)).toThrow('シナリオ参照')
    delete source.richMenu.pages[0].areas[0].scenarioId
    source.richMenu.pages[0].areas[0].bounds.width = 1200
    expect(() => hqDefinitionToRichMenuCreateValue(source)).toThrow('自由配置')
  })

  it('登録済み画像を保持できないサイズ変更を停止する', () => {
    const source = definition()
    const draft = hqDefinitionToRichMenuCreateValue(source)
    expect(() => richMenuCreateValueToHqDefinition({ ...draft, size: 'compact', templateKey: 'compact-full' }, source)).toThrow('登録済み画像')
  })
})
