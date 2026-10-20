import { expect, it } from 'vitest'
import { ACCOUNT_STYLES } from '@line-crm/shared'
import { MENU_SECTIONS } from '@/lib/menu'
import { styleMenuItemVisible, styleMenuLabel } from './style-menu'
const items = MENU_SECTIONS.flatMap(section => section.items)
const item = (href: string) => items.find(item => item.href === href)!
it.each(ACCOUNT_STYLES)('%sの飲食・EC・予約の初期表示を既存の機能設定と重ねる', style => {
  const shown = items.filter(item => styleMenuItemVisible(item, style, false))
  expect(shown.some(item => item.featureKey === 'restaurant_test')).toBe(style === 'restaurant')
  expect(shown.some(item => item.href === '/ec-commerce')).toBe(style === 'ec' || style === 'restaurant')
  expect(shown.some(item => item.href === '/events')).toBe(style === 'lesson' || style === 'restaurant')
  for (const required of items.filter(item => item.required)) expect(shown).toContain(required)
})
it('明示した共通機能をスタイル変更で落とさず、飲食専用へは広げない', () => {
  expect(styleMenuItemVisible(item('/events'), 'standard', true)).toBe(true)
  expect(styleMenuItemVisible(item('/booking/bookings'), 'ec', true)).toBe(true)
  const restaurants = items.filter(item => item.featureKey === 'restaurant_test')
  for (const item of restaurants) expect(styleMenuItemVisible(item, 'consult', true)).toBe(false)
})
it('業種未取得なら専用機能を隠し、辞書のメニュー名を使う', () => {
  expect(styleMenuItemVisible(item('/ec-commerce'), null, true)).toBe(false)
  expect(styleMenuLabel(item('/'), 'consult')).toBe('ダッシュボード')
  expect(styleMenuLabel(item('/events'), 'lesson')).toBe('イベント予約')
})

it('保存版が無い旧staff読取では、許可済みの共通機能の履歴を隠さない', () => {
  expect(styleMenuItemVisible(item('/events'), 'standard', null)).toBe(true)
  expect(styleMenuItemVisible(item('/booking/bookings'), 'ec', null)).toBe(true)
  expect(styleMenuItemVisible(item('/restaurant-test/reservations'), 'standard', null)).toBe(false)
})

it('ECの共通機能を保存しただけでは、専用の契約を推測しない', () => {
  const specialized = items.filter(item => item.href.startsWith('/nen') || item.featureKey === 'photo_review' || item.featureKey === 'nen_campaigns')
  expect(specialized.length).toBeGreaterThan(0)
  for (const item of specialized) {
    expect(styleMenuItemVisible(item, 'ec', true)).toBe(false)
    expect(styleMenuItemVisible(item, 'restaurant', true)).toBe(true)
  }
})
