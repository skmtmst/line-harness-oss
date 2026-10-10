import { describe, expect, it } from 'vitest'
// @ts-expect-error Node CLI helper
import { regenerateFrozenMap, regenerateFrozen1011Map } from './frozen-v8-design-map.mjs'

const board = (url: string) => ({ doc: 'V8-B', name: '旧', kind: '画面', route: url, url, routes: [url], width: 1440 })
const row = (kind: string, old: string, next: string) => ({ 種類: kind, 旧ID: old, 新ID: next, 名前: '板', 文書: 'V8.pen', route: '', 備考: '' })

describe('2026-10-10 固定書き出しへの付け替え', () => {
  it('融合の正のURLと撮影データを保ち、旧の詳細画面へ戻さない', () => {
    const seed = { boards: { AjZhH: board('/booking/bookings'), xzR4g: { ...board('/restaurant-test/reservations'), doc: 'V8', state: { api: ['fixture'] } } } }
    const change = row('旧の置き場へ', 'AjZhH', 'xzR4g')
    const { map, routeRows } = regenerateFrozenMap(seed, [change], { xzR4g: '予約台帳 一覧・予約の詳細' })
    expect(map.boards.AjZhH).toBeUndefined()
    expect(map.boards.xzR4g.url).toBe('/restaurant-test/reservations')
    expect(map.boards.xzR4g.state).toEqual({ api: ['fixture'] })
    expect(routeRows[0].route).toBe('/restaurant-test/reservations')
    expect(seed.boards.AjZhH).toBeDefined()
  })

  it('追加の1152板は1440の状態を引き継ぎ、幕は撮影対象にしない', () => {
    const seed = { boards: { R2w4j: { ...board('/restaurant-test/reservations'), state: { api: ['today'] } } } }
    const changes = [row('増えた', '', 'xOQKw'), row('増えた', '', 'Bb8xi')]
    const { map } = regenerateFrozenMap(seed, changes, { xOQKw: '今日1152', Bb8xi: '後ろの画面' })
    expect(map.boards.xOQKw.width).toBe(1152)
    expect(map.boards.xOQKw.state).toEqual({ api: ['today'] })
    expect(map.boards.Bb8xi.width).toBeNull()
    expect(regenerateFrozenMap(map, changes, { xOQKw: '今日1152', Bb8xi: '後ろの画面' }).map).toEqual(map)
  })

  it('隠された板は正の板名が一致したときだけ付け替える', () => {
    const seed = { boards: { gobhu: board('/hq/rich-menus'), VIij4: board('/hq/rich-menus') } }
    const changes = [row('隠した', 'gobhu', '')]
    expect(regenerateFrozenMap(seed, changes, { VIij4: '別の画面' }).unresolved).toEqual(['gobhu'])
    const result = regenerateFrozenMap(seed, changes, { VIij4: '統括 作る① 形と画像 V8' })
    expect(result.map.replacements.gobhu).toBe('VIij4')
    expect(result.map.boards.gobhu).toBeUndefined()
    expect(result.routeRows[0]['新ID']).toBe('VIij4')
  })
})


describe('2026-10-11 固定書き出し', () => {
  const inventory = (id: string) => ({ 板ID: id, 文書: 'V8', 板の名前: '新しい画面', 区分: '地図', 幅: '1440' })
  it('消えた板は削除前の一覧にあっても復活せず、旧から正への対応を保つ', () => {
    const seed = { boards: { old: board('/old'), live: board('/live') }, replacements: { old: 'live' } }
    const result = regenerateFrozen1011Map(seed, [{ 旧ID: 'old', 新ID: '（なし）' }], [inventory('old'), inventory('live')], { old: '旧', live: '正' }, {})
    expect(result.map.boards.old).toBeUndefined()
    expect(result.map.replacements.old).toBe('live')
    expect(result.map.deletedBoards).toContain('old')
    expect(result.routeRows[0].route).toBe('/live')
    expect(seed.boards.old).toBeDefined()
  })
  it('新しい状態へ撮影データを引き継ぎ、正のタブ・幅・固定写しの置き場を持つ', () => {
    const seed = { boards: { live: { ...board('/live'), state: { api: ['fixture'] }, shot: 'old.png' } } }
    const specs = { added: { from: 'live', url: '/live?tab=info', width: 1152, state: { manual: '情報欄を開く' } } }
    const result = regenerateFrozen1011Map(seed, [], [inventory('added')], { added: '情報欄' }, specs)
    const entry = result.map.boards.added
    expect(entry.route).toBe('/live')
    expect(entry.url).toBe('/live?tab=info')
    expect(entry.width).toBe(1152)
    expect(entry.state).toEqual({ api: ['fixture'], manual: '情報欄を開く' })
    expect(entry.exportHtml).toBe('html/added.html')
    expect(entry.exportTexts).toBe('pencil-texts/added.tsv')
    expect(entry.shot).toBeNull()
    expect(regenerateFrozen1011Map(result.map, [], [inventory('added')], { added: '情報欄' }, specs).map).toEqual(result.map)
  })
  it('未対応の新しい板は場所を推測せず一覧にする', () => {
    const result = regenerateFrozen1011Map({ boards: {} }, [], [inventory('unknown')], { unknown: '新しい画面' }, {})
    expect(result.unresolved).toEqual(['unknown'])
    expect(result.map.boards.unknown.url).toBeNull()
  })
})
