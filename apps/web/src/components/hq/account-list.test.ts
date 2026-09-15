import { describe, expect, it } from 'vitest'
import type { AccountWithStats } from '@/contexts/account-context'
import { accountIconUrl } from './account-list'

const account = (values: Partial<AccountWithStats>): AccountWithStats => ({
  id: 'account-1',
  channelId: '123',
  name: '運用名',
  isActive: true,
  country: null,
  role: null,
  displayOrder: 0,
  ...values,
})

describe('統括アカウント一覧のアイコン', () => {
  it('LINE公式画像、手動画像、頭文字の順で使う', () => {
    expect(accountIconUrl(account({ pictureUrl: 'https://line.example/icon.jpg', iconUrl: 'https://manual.example/icon.jpg' })))
      .toBe('https://line.example/icon.jpg')
    expect(accountIconUrl(account({ pictureUrl: null, iconUrl: 'https://manual.example/icon.jpg' })))
      .toBe('https://manual.example/icon.jpg')
    expect(accountIconUrl(account({ pictureUrl: null, iconUrl: null }))).toBeNull()
  })
})
