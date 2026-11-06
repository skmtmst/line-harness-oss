/*
 * 統括のリッチメニューを店の作る画面で作る口（・gobhu〜gQabc）：画面の中の下書き ↔ 統括のひな形の定義。
 */
import { describe, expect, it } from 'vitest'
import { tapActionLiffUrl } from './tap-actions'
import { hqRichMenuDefinitionFromSeed, hqRichMenuSeedFromDefinition, type HqRichMenuSeed } from './hq-rich-menu-create'

const area = (id: string, intent: string, actionData: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id, boundsX: 0, boundsY: 0, boundsWidth: 833, boundsHeight: 843, actionType: 'uri' as const, actionData, intent: intent as never,
  label: null, tagIds: [], scoreChange: null, templateId: null, formId: null, trackedLinkId: null, ...extra,
})
const seed = (areas: HqRichMenuSeed['pages'][number]['areas']): HqRichMenuSeed => ({
  name: '通常メニュー', chatBarText: 'メニュー', folderId: null, size: 'large', displayAudience: 'store', displayTagName: '', defaultOpen: true, displayOrder: 2,
  defaultPageId: 'tmp-x', pages: [{ id: 'tmp-x', name: 'トップ', imageR2Key: 'hq-templates/t/a.png', areas }],
})

describe('統括のリッチメニューの下書き → ひな形の定義', () => {
  it('動きごとに LINE の種類と中身を決め、出す相手・順番を残す。使えない ID は作り直す', () => {
    const def = hqRichMenuDefinitionFromSeed(seed([
      area('a 1', 'url', { uri: 'https://nen.example/booking', extra: 'x' }, { label: '予約する' }),
      area('a-2', 'text', { text: '会員証' }, { tagIds: ['tag-1'] }),
      area('a-3', 'switch', { targetPageId: 'tmp-x' }),
    ]))
    const [page] = def.richMenu.pages
    expect(def.richMenu.displayAudience).toBe('store')
    expect(def.richMenu.displayOrder).toBe(2)
    expect(page.id).toBe('tmp-x')
    expect(page.areas[0]).toMatchObject({ actionType: 'uri', actionData: { uri: 'https://nen.example/booking' }, intent: 'url', label: '予約する' })
    expect(page.areas[0].id).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(page.areas[1]).toMatchObject({ actionType: 'message', actionData: { text: '会員証' }, tagIds: ['tag-1'] })
    expect(page.areas[2]).toMatchObject({ actionType: 'richmenuswitch', actionData: { targetPageId: 'tmp-x' } })
    expect(def.richMenu.defaultPageId).toBe('tmp-x')
  })

  it('画像が無いページ・計測リンク・URL のボタンのタグは保存の前に断る', () => {
    expect(() => hqRichMenuDefinitionFromSeed({ ...seed([]), pages: [{ id: 'p', name: 'トップ', imageR2Key: null, areas: [] }] })).toThrow('画像')
    expect(() => hqRichMenuDefinitionFromSeed(seed([area('a', 'url', { uri: 'https://x.example' }, { trackedLinkId: 'l' })]))).toThrow('計測リンク')
    expect(() => hqRichMenuDefinitionFromSeed(seed([area('a', 'url', { uri: 'https://x.example' }, { tagIds: ['t'] })]))).toThrow('タグ')
  })

  it('「タグが付いた人」と開閉は、タグ名つきで保存し、そのまま戻る', () => {
    const def = hqRichMenuDefinitionFromSeed({ ...seed([area('a-1', 'url', { uri: 'https://example.com' })]), displayAudience: 'tag', displayTagName: ' 会員 ', defaultOpen: false })
    expect(def.richMenu).toMatchObject({ displayAudience: 'tag', displayTagName: '会員', defaultOpen: false })
    const back = hqRichMenuSeedFromDefinition(def, null)
    expect(back).toMatchObject({ displayAudience: 'tag', displayTagName: '会員', defaultOpen: false })
  })

  it('予約・予約履歴・来店スタンプは種類だけを保存し、戻すと LIFF の仮の URL に戻る', () => {
    const liff = (kind: 'booking' | 'booking_history' | 'visit_stamp', ref = '') => area('l-' + kind, 'url', { uri: tapActionLiffUrl('{{liff_id}}', kind, ref) })
    const def = hqRichMenuDefinitionFromSeed(seed([liff('booking', 'menu-1'), liff('booking_history'), liff('visit_stamp')]))
    const areas = def.richMenu.pages[0].areas as unknown as Array<{ intent: string; actionData: Record<string, string>; actionType: string }>
    expect(areas.map((a) => a.intent)).toEqual(['booking', 'booking_history', 'visit_stamp'])
    expect(areas[0]).toMatchObject({ actionType: 'uri', actionData: { menuId: 'menu-1' } })
    expect(areas[1].actionData).toEqual({})
    const back = hqRichMenuSeedFromDefinition(def, null)
    expect(back.pages[0].areas.map((a) => a.intent)).toEqual(['url', 'url', 'url'])
    expect(hqRichMenuDefinitionFromSeed(back)).toEqual(def)
  })

  it('タグ名が空のまま「タグが付いた人」では保存できない', () => {
    expect(() => hqRichMenuDefinitionFromSeed({ ...seed([area('a-1', 'url', { uri: 'https://example.com' })]), displayAudience: 'tag', displayTagName: '  ' })).toThrow('タグの名前')
  })

  it('保存してある定義から下書きに戻すと、同じ定義に戻る', () => {
    const def = hqRichMenuDefinitionFromSeed(seed([area('a-1', 'url', { uri: 'https://nen.example' })]))
    expect(hqRichMenuDefinitionFromSeed(hqRichMenuSeedFromDefinition(def, null))).toEqual(def)
  })
})
