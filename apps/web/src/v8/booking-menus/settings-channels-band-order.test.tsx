// @vitest-environment happy-dom
/*
 * B12: 予約設定「予約経路の連携」タブで、数の帯をタブの段の上に出さない。
 * 帯がタブの上に挟まると、このタブだけタブの段が下へ跳ぶ。帯はタブの下の本文へ。
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams('tab=channels'),
}))

vi.mock('./channels-tab', () => ({
  default: () => <section data-testid="channels-tab-body">予約経路の本文</section>,
}))

vi.mock('@/v8/booking-passes/index', () => ({
  PassesTabV8: () => null,
}))

vi.mock('./settings-parts', () => ({
  MenusTabV8: () => null,
  HoursTabV8: () => null,
  HolidaysTabV8: () => null,
  RulesTabV8: () => null,
  StaffTabV8: () => null,
  PaymentsTabV8: () => null,
  PaymentsSideV8: () => null,
  PhotosTabV8: () => null,
  V8_TABS: [
    { key: 'menus', label: 'メニュー', node: 'owaS3' },
    { key: 'channels', label: '予約経路の連携', node: 'ZyDd6' },
  ],
}))

import BookingSettingsView from './settings-view'

afterEach(cleanup)

function props() {
  return {
    accountId: 'account-a',
    tab: 'channels',
    previewUrl: null,
    tabNode: 'ZyDd6',
    canEditMenus: true,
    canEditSettings: true,
    tabReadOnly: false,
    menus: [],
    menusStatus: 'ready',
    menusError: null,
    settings: null,
    settingsStatus: 'ready',
    settingsError: null,
    staff: [],
    staffStatus: 'ready',
    staffError: null,
    staffMatrices: null,
    staffExtras: null,
    members: [],
    resources: null,
    resourcesStatus: 'ready',
    resourcesError: null,
    closedBookingCount: 0,
    storeExceptions: [],
    tabEdit: null,
    hasChanges: false,
    registerTabEdit: () => () => {},
    switchTarget: null,
    setSwitchTarget: () => {},
    requestTab: () => {},
    confirmSwitch: () => {},
    reloadCore: () => {},
    saveSettings: () => {},
    saveResource: () => {},
    createResource: () => {},
    deleteResource: () => {},
    retryResources: () => {},
    closedWeekdays: [],
    phone: null,
  } as unknown as Parameters<typeof BookingSettingsView>[0]
}

it('数の帯はタブの段の中に出さず、タブの段より後ろの本文へ出す', () => {
  render(<BookingSettingsView {...props()} />)
  const tabs = screen.getByRole('tablist', { name: '予約設定のタブ' })
  const tabsRegion = tabs.closest('[data-template-region="tabs"]') as HTMLElement
  expect(tabsRegion).not.toBeNull()
  expect(tabsRegion.querySelector('[aria-label="予約経路の数の帯"]')).toBeNull()
  const band = screen.getByLabelText('予約経路の数の帯')
  expect(tabs.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
})

it('B12: channels のタブの段はメニューと同じ余白（createFlow の上24pxを付けない）', () => {
  const channels = render(<BookingSettingsView {...props()} />)
  expect(channels.container.querySelector('[data-template-region="create-flow"]')).toBeNull()
  channels.unmount()
  const menus = render(<BookingSettingsView {...{ ...props(), tab: 'menus' }} />)
  expect(menus.container.querySelector('[data-template-region="create-flow"]')).toBeNull()
  menus.unmount()
})
