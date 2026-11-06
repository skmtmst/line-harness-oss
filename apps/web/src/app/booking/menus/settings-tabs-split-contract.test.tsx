// @vitest-environment happy-dom
import React, { useEffect, useState, type ComponentType } from 'react'
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const trace = vi.hoisted(() => ({ calls: new Map<string, number>(), loaders: 0, hold: false }))
vi.mock('next/dynamic', () => ({ default: (load: () => Promise<ComponentType>, options: { loading: ComponentType }) => function Deferred(props: object) {
  const [Part, setPart] = useState<ComponentType | null>(null)
  useEffect(() => { if (!trace.hold) { trace.loaders++; void load().then(part => setPart(() => part)) } }, [])
  return Part ? <Part {...props} /> : <options.loading />
} }))
function part(name: string) {
  return function Part() { trace.calls.set(name, (trace.calls.get(name) ?? 0) + 1); return <span>{name}</span> }
}
vi.mock('@/v8/booking-menus/tabs/menus-tab', () => ({ MenusTabV8: part('メニュー') }))
vi.mock('@/v8/booking-menus/tabs/hours-tab', () => ({ HoursTabV8: part('受付枠') }))
vi.mock('@/v8/booking-menus/tabs/holidays-tab', () => ({ HolidaysTabV8: part('休業日') }))
vi.mock('@/v8/booking-menus/tabs/rules-tab', () => ({ RulesTabV8: part('予約のルール') }))
vi.mock('@/v8/booking-menus/tabs/staff-tab', () => ({ StaffTabV8: part('担当スタッフ') }))
vi.mock('@/v8/booking-menus/liff-phone', () => ({ LiffPhoneMenuStep: part('メニューの見え方'), LiffPhoneDatetimeStep: part('日時の見え方'), LiffPhoneStaffStep: part('担当の見え方') }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccount: null }) }))
vi.mock('@/v8/booking-menus/lib/edit-permission', () => ({ useBookingEdit: () => true }))
vi.mock('@/lib/use-unsaved-guard', () => ({ useUnsavedGuard: () => ({ leaveTarget: null, confirmLeave: () => {}, cancelLeave: () => {} }) }))

import { MenusTabV8, HoursTabV8, HolidaysTabV8, RulesTabV8, StaffTabV8, LiffPhoneMenuStep, LiffPhoneDatetimeStep, LiffPhoneStaffStep } from '@/v8/booking-menus/settings-parts'
import { useBookingSettings } from '../../../v8/booking-menus/use-booking-settings'
const parts = [MenusTabV8, HoursTabV8, HolidaysTabV8, RulesTabV8, StaffTabV8, LiffPhoneMenuStep, LiffPhoneDatetimeStep, LiffPhoneStaffStep] as ComponentType[]
afterEach(cleanup)
beforeEach(() => { trace.calls.clear(); trace.loaders = 0; trace.hold = false })

it('開いていないタブは読まない', async () => {
  expect(trace.loaders).toBe(0)
  render(<MenusTabV8 {...{} as React.ComponentProps<typeof MenusTabV8>} />)
  await screen.findByText('メニュー')
  expect(trace.loaders).toBe(1)
  expect([...trace.calls.keys()]).toEqual(['メニュー'])
})

it.each([['受付枠', HoursTabV8], ['休業日', HolidaysTabV8], ['予約のルール', RulesTabV8], ['担当スタッフ', StaffTabV8]] as const)('選んだ%sだけを描く', async (name, Part) => {
  render(React.createElement(Part as ComponentType))
  await screen.findByText(name)
  expect([...trace.calls.keys()]).toEqual([name])
})

it.each(parts.map((Part, index) => [index, Part] as const))('読み待ちの部品%sは骨組みを残す', async (_, Part) => {
  trace.hold = true
  render(<Part />)
  expect(await screen.findByRole('status', { name: '読み込み中' })).toBeTruthy()
  expect(trace.loaders).toBe(0)
})

it.each([['メニューの見え方', LiffPhoneMenuStep], ['日時の見え方', LiffPhoneDatetimeStep], ['担当の見え方', LiffPhoneStaffStep]] as const)('選んだ%sを読む', async (name, Part) => {
  render(React.createElement(Part as ComponentType))
  await screen.findByText(name)
  expect(trace.loaders).toBe(1)
})

it('同じ中身で殻を描き直してもタブを描き直さない', async () => {
  const props = {} as React.ComponentProps<typeof MenusTabV8>
  const { rerender } = render(<MenusTabV8 {...props} />)
  await screen.findByText('メニュー')
  const before = trace.calls.get('メニュー')
  rerender(<MenusTabV8 {...props} />)
  expect(trace.calls.get('メニュー')).toBe(before)
})

it('プレビューの開閉でタブの保存と読み直しの手を変えない', async () => {
  const { result } = renderHook(() => useBookingSettings(null))
  await act(async () => {})
  const before = result.current
  await act(async () => result.current.setPhoneOpen(true))
  for (const key of ['reloadCore', 'saveSettings', 'saveResource', 'createResource', 'deleteResource', 'retryResources'] as const) expect(result.current[key]).toBe(before[key])
})

it('書きかけは共通の登録口から離脱確認へ届く', async () => {
  const { result } = renderHook(() => useBookingSettings(null))
  await act(async () => {})
  const edit = { dirty: true, subject: '変更', saving: false, onSave: vi.fn(), onReset: vi.fn() }
  await act(async () => result.current.registerTabEdit(edit))
  expect(result.current.tabEdit).toBe(edit)
  await act(async () => result.current.requestTab('hours'))
  expect(result.current.switchTarget).toBe('hours')
  await act(async () => result.current.confirmSwitch())
  expect(edit.onReset).toHaveBeenCalledOnce()
})
