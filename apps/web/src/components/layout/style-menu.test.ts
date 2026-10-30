import { expect, it } from 'vitest'
import { ACCOUNT_STYLES } from '@line-crm/shared'
import { MENU_SECTIONS } from '@/lib/menu'
import { styleMenuItemVisible, styleMenuLabel } from './style-menu'
const visible = (item: (typeof MENU_SECTIONS)[number]['items'][number], style: (typeof ACCOUNT_STYLES)[number] | null, configured: boolean | null, selected = true) => styleMenuItemVisible(item, style, configured, selected)
const items = MENU_SECTIONS.flatMap(section => section.items)
const item = (href: string) => items.find(item => item.href === href)!
it.each(ACCOUNT_STYLES)('%sの飲食・EC・予約の初期表示を既存の機能設定と重ねる', style => {
  const shown = items.filter(item => visible(item, style, false))
  expect(shown.some(item => item.featureKey === 'restaurant_test')).toBe(style === 'restaurant')
  expect(shown.some(item => item.href === '/ec-commerce')).toBe(style === 'ec')
  expect(shown.some(item => item.href === '/events')).toBe(style === 'lesson' || style === 'restaurant')
  for (const required of items.filter(item => item.required)) expect(shown).toContain(required)
})
it('明示した共通機能をスタイル変更で落とさず、飲食専用へは広げない', () => {
  expect(visible(item('/events'), 'standard', true)).toBe(true)
  expect(visible(item('/booking/bookings'), 'ec', true)).toBe(true)
  const restaurants = items.filter(item => item.featureKey === 'restaurant_test')
  for (const item of restaurants) expect(visible(item, 'consult', true)).toBe(false)
})
it('業種未取得なら専用機能を隠し、辞書のメニュー名を使う', () => {
  expect(visible(item('/ec-commerce'), null, true)).toBe(false)
  expect(styleMenuLabel(item('/'), 'consult')).toBe('ダッシュボード')
  expect(styleMenuLabel(item('/events'), 'lesson')).toBe('イベント予約')
})

it('保存版が無い旧staff読取では、許可済みの共通機能の履歴を隠さない', () => {
  expect(visible(item('/events'), 'standard', null)).toBe(true)
  expect(visible(item('/booking/bookings'), 'ec', null)).toBe(true)
  expect(visible(item('/restaurant-test/reservations'), 'standard', null)).toBe(false)
})

it('ECの共通機能を保存しただけでは、専用の契約を推測しない', () => {
  const specialized = items.filter(item => item.href.startsWith('/nen') || item.featureKey === 'photo_review' || item.featureKey === 'nen_campaigns')
  expect(specialized.length).toBeGreaterThan(0)
  for (const item of specialized) {
    expect(visible(item, 'ec', true)).toBe(false)
    expect(visible(item, 'restaurant', true)).toBe(true)
  }
})

it.each([false, true, null])('飲食は機能設定%sでも人用の予約3経路とEC連携を除き、ほかの項目を残す', configured => {
  const excluded = ['/booking/bookings', '/booking/menus', '/booking/staff/shifts', '/ec-commerce']
  for (const href of excluded) expect(visible(item(href), 'restaurant', configured)).toBe(false)
  for (const entry of items.filter(entry => !excluded.includes(entry.href))) expect(visible(entry, 'restaurant', configured)).toBe(true)
})
it.each(['salon', 'consult', 'lesson'] as const)('%sの人用予約と自分の勤務の入口は引き続き表示候補にする', style => {
  for (const configured of [false, true, null]) for (const href of ['/booking/bookings', '/booking/menus', '/booking/staff/shifts']) {
    expect(visible(item(href), style, configured)).toBe(true)
  }
})

it('ECの使い方を未確定なら、保存中のEC値だけでは入口を出さない', () => {
  expect(visible(item('/ec-commerce'), 'ec', true, false)).toBe(false)
  expect(visible(item('/ec-commerce'), 'ec', true, true)).toBe(true)
})
