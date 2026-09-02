import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_INDEPENDENT_ROUTE_PREFIXES,
  decideStoreRoute,
  isAccountIndependentRoute,
} from './store-route-guard'

describe('店舗選択が不要な画面', () => {
  it('対象外ルートを1か所の定数で管理する', () => {
    expect(ACCOUNT_INDEPENDENT_ROUTE_PREFIXES).toEqual([
      '/hq',
      '/login',
      '/staff',
      '/settings',
      '/emergency',
      '/health',
      '/accounts',
      '/restaurant-test/stores',
      '/restaurant-test/terms',
    ])
  })

  it.each([
    '/hq',
    '/hq/settings',
    '/login',
    '/staff',
    '/settings',
    '/emergency',
    '/health',
    '/accounts',
    '/accounts/new',
    '/restaurant-test/stores/new',
    '/restaurant-test/terms',
  ])('%sは店舗未選択でも開ける', (pathname) => {
    expect(isAccountIndependentRoute(pathname)).toBe(true)
  })

  it.each(['/friends', '/chats', '/tags', '/templates', '/rich-menus', '/form-submissions'])('%sは店舗選択が必要', (pathname) => {
    expect(isAccountIndependentRoute(pathname)).toBe(false)
    expect(decideStoreRoute(pathname, false, null)).toBe('block-unselected')
  })

  it('店舗画面は読込完了前も子画面を表示しない', () => {
    expect(decideStoreRoute('/friends', true, null)).toBe('wait')
    expect(decideStoreRoute('/friends', false, 'account-1')).toBe('show')
  })

  it('似た名前の別ルートを対象外にしない', () => {
    expect(isAccountIndependentRoute('/healthcheck')).toBe(false)
    expect(isAccountIndependentRoute('/accounting')).toBe(false)
  })
})
