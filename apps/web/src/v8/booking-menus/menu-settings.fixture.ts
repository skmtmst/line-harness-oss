import React from 'react'
import type { ComponentProps } from 'react'
import type MenuSettingsPage from './menu-settings-page'

export function menuSettingsModel(canEditMenus = false): ComponentProps<typeof MenuSettingsPage> {
  return {
    menuFormState: { dirty: false }, accountId: 'account-test', tabNode: 'P6EdLW', canEditMenus, menus: [], menusStatus: 'ready',
    menusError: null, settings: null, reloadCore: () => {}, previewUrl: 'https://example.test/booking',
    phone: React.createElement('span', null, '予約画面の見え方'), setPhoneOpen: () => {}, requestTab: () => {},
  }
}
