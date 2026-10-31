import { describe, expect, it } from 'vitest'
import { canonicalNavigationHref, canonicalScreenPath, legacyRouteDestination } from './canonical-route'
import { MENU_SECTIONS, menuOwnerForScreen } from './menu'
import { defaultTitleForPath, documentTitleForPath } from './page-title'
import { manualScreenKeyForPath } from './manual-screen-key'

describe('正規の画面への入口', () => {
  it.each(['affiliates', 'offers', 'approvals', 'payment', 'points', 'report'])('成果の指定 %s と条件を運ぶ', tab => {
    const url = new URL(canonicalNavigationHref(`/conversions?tab=${tab}&q=春&pointId=cp-1#rows`), 'https://example.test')
    expect(url.pathname).toBe('/affiliates')
    expect(url.searchParams.get('tab')).toBe(tab)
    expect(url.searchParams.get('q')).toBe('春')
    expect(url.searchParams.get('pointId')).toBe('cp-1')
    expect(url.hash).toBe('#rows')
  })
  it.each(['', '?tab=bad'])('指定が無い成果の入口 %s は成果地点へ', search => {
    expect(legacyRouteDestination('/conversions', search)).toBe('/affiliates?tab=points')
  })
  it('案件・設定・自動応答でも指定と見出しジャンプを保つ', () => {
    expect(canonicalNavigationHref('/affiliate-offers?q=a#rows')).toBe('/affiliates?q=a&tab=offers#rows')
    expect(canonicalNavigationHref('/settings/features?q=a#list')).toBe('/settings?q=a#list')
    expect(canonicalNavigationHref('/auto-replies/publish?id=ar-1&step=basic#preview')).toBe('/auto-replies/edit?id=ar-1&step=priority#preview')
    expect(legacyRouteDestination('/auto-replies/publish')).toBe('/auto-replies/edit?step=priority')
  })
  it.each(['/conversions/new', '/conversions/edit?id=cp-1', '/affiliate-offers/new', '/m', '/hq/open', '/booking/staff/shifts', '#list', 'https://example.test/conversions', '//example.test/conversions', '/conversions\\evil'])('固定の転送でない %s は変えない', href => {
    expect(canonicalNavigationHref(href)).toBe(href)
  })
  it('サーバーの固定転送も同じ行き先を使う', () => {
    expect(legacyRouteDestination('/restaurant-test')).toBe('/hq')
    expect(legacyRouteDestination('/restaurant-test/stores')).toBe('/hq')
    expect(legacyRouteDestination('/ops')).toBe('/ops/tenants')
  })
  it('題と説明書は正規画面から、権限は元の鍵から引く', () => {
    const menu = MENU_SECTIONS.flatMap(section => section.items)
    expect(menu.find(item => item.id === 'affiliates')).toMatchObject({ href: '/affiliates?tab=affiliates', permissionKey: '/conversions?tab=affiliates' })
    expect(menu.find(item => item.id === 'conversions')).toMatchObject({ href: '/affiliates?tab=points', permissionKey: '/conversions' })
    expect(menuOwnerForScreen('/conversions', 'tab=affiliates')).toEqual(['affiliates'])
    expect(menuOwnerForScreen('/conversions', '')).toEqual(['conversions'])
    expect(defaultTitleForPath('/conversions')).toBe('成果とアフィリエイト')
    expect(defaultTitleForPath('/affiliate-offers')).toBe('成果とアフィリエイト')
    expect(manualScreenKeyForPath('/conversions')).toBe(manualScreenKeyForPath('/affiliates'))
    expect(manualScreenKeyForPath('/conversions/new')).toBe('19-1')
    expect(canonicalScreenPath('/settings/features')).toBe('/settings')
    expect(documentTitleForPath('/ops', '')).toBe(documentTitleForPath('/ops/tenants', ''))
    expect(documentTitleForPath('/restaurant-test', '')).toBe(documentTitleForPath('/hq', ''))
  })
})
