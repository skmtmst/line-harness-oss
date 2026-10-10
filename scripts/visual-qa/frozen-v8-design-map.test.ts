import { describe, expect, it } from 'vitest'
// @ts-expect-error Node CLI helper
import { regenerateFrozenMap } from './frozen-v8-design-map.mjs'

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
