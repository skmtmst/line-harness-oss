// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaItem } from '@line-crm/shared'
import type { BookingMenu, BookingSettings, BookingStaff } from '@/lib/api'

/**
 * V8 予約設定の写真タブ（B-1『店の写真』）。
 *
 * - お店・メニュー・スタッフの枠が出る。空の枠は『写真を選ぶ』
 * - 選ぶ窓には登録メディアが並び、使っている写真には「使用中・削除不可」と出る
 * - 選んだら各保存口へ写真のIDが送られる（付け替え・取り外しも同じ口）
 */
const fixture = vi.hoisted(() => ({
  updateMenu: vi.fn(),
  updateStaff: vi.fn(),
  saveSettings: vi.fn(),
  mediaList: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  bookingApi: {
    updateMenu: (...args: unknown[]) => fixture.updateMenu(...args),
    updateStaff: (...args: unknown[]) => fixture.updateStaff(...args),
    saveSettings: (...args: unknown[]) => fixture.saveSettings(...args),
  },
  api: {
    media: {
      list: (...args: unknown[]) => fixture.mediaList(...args),
      contentUrl: (id: string) => `/api/media/${id}/content`,
    },
  },
}))

vi.mock('@/components/shared/toast', () => ({
  notifyToast: (...args: unknown[]) => fixture.toast(...args),
}))

const { default: PhotosTabV8 } = await import('./photos-v8')

const photo = (id: string, usageCount = 0): MediaItem => ({
  id,
  lineAccountId: 'account-a',
  folderId: null,
  kind: 'image',
  filename: `${id}.png`,
  mimeType: 'image/png',
  sizeBytes: 1200,
  width: 100,
  height: 100,
  durationMs: null,
  url: `https://cdn.example.test/${id}.png`,
  uploadedBy: '管理者',
  createdAt: '2026-10-04T09:00:00+09:00',
  usageCount,
})

const menus: BookingMenu[] = [
  {
    id: 'menu-1', name: 'カット', category_label: null, description: null,
    duration_minutes: 60, buffer_after_minutes: 0, base_price: 5000,
    sort_order: 0, is_active: 1, auto_tag_id: null, version: 4,
    photo_media_id: 'photo-used', photo_url: 'https://cdn.example.test/photo-used.png',
  },
  {
    id: 'menu-2', name: 'カラー', category_label: null, description: null,
    duration_minutes: 90, buffer_after_minutes: 0, base_price: 8000,
    sort_order: 1, is_active: 1, auto_tag_id: null, version: 1,
    photo_media_id: null, photo_url: null,
  },
]

const staff: BookingStaff[] = [
  {
    id: 'staff-1', name: '担当', display_name: '山田', role: null,
    profile_image_url: null, bio: null, sort_order: 0,
    is_designation_optional: 0, is_active: 1,
    photo_media_id: null, photo_url: null,
  },
]

const settings: BookingSettings = {
  id: 'settings-1',
  lineAccountId: 'account-a',
  version: 3,
  timeZone: 'Asia/Tokyo',
  bookingWindowDays: 60,
  cutoffMinutesBefore: 1440,
  cancelDeadlineMinutesBefore: 1440,
  maxActiveBookingsPerFriend: 1,
  approvalMode: 'automatic',
  holdMinutes: 15,
  slotGranularityMinutes: 15,
  reminderDayBeforeTime: null,
  reminderHoursBefore: null,
  liffDateView: 'list',
  storePhotoMediaId: null,
  store_photo_url: null,
}

let host: HTMLDivElement
let root: Root

const baseProps = {
  accountId: 'account-a',
  menus,
  menusStatus: 'ready' as const,
  menusError: null,
  staff,
  staffStatus: 'ready' as const,
  staffError: null,
  settings,
  settingsStatus: 'ready' as const,
  settingsError: null,
  canEditMenus: true,
  canEditSettings: true,
  onReload: vi.fn(),
}

function renderTab(props: Partial<typeof baseProps> = {}) {
  act(() => {
    root.render(React.createElement(PhotosTabV8, { ...baseProps, ...props }))
  })
}

function buttons(label: string): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll('button')).filter(
    (button) => button.textContent?.includes(label),
  ) as HTMLButtonElement[]
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  fixture.updateMenu.mockReset().mockResolvedValue({ ok: true, version: 2 })
  fixture.updateStaff.mockReset().mockResolvedValue({ ok: true })
  fixture.saveSettings.mockReset().mockResolvedValue({ success: true, data: settings })
  fixture.mediaList.mockReset().mockResolvedValue({
    success: true,
    data: { items: [photo('photo-used', 2), photo('photo-free', 0)], total: 2, limit: 20, offset: 0 },
  })
  fixture.toast.mockReset()
  baseProps.onReload = vi.fn()
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  host.remove()
  // 選ぶ窓はポータルで文書直下に出る。次の試験に残さない。
  document.body.innerHTML = ''
})

describe('予約設定の写真タブ', () => {
  it('お店・メニュー・スタッフの枠が出て、空の枠は『写真を選ぶ』', () => {
    renderTab()
    expect(host.textContent).toContain('お店の写真')
    expect(host.textContent).toContain('メニューの写真')
    expect(host.textContent).toContain('スタッフの写真')
    // 空は3枠（お店・カラー・山田）。写真付きのカットには出ない。
    expect(buttons('写真を選ぶ')).toHaveLength(3)
    expect(host.querySelector('img[alt="カットの写真"]')).not.toBeNull()
  })

  it('選ぶ窓には使っている写真に「使用中・削除不可」と出る', async () => {
    renderTab()
    const choose = buttons('写真を選ぶ')[0]
    await act(async () => {
      choose.click()
    })
    // 選ぶ窓はポータルに出るため、文書全体から探す。
    expect(document.body.textContent).toContain('photo-used.png')
    expect(document.body.textContent).toContain('2か所で使用中・削除不可')
  })

  it('スタッフの写真を選ぶと保存口へIDが送られる', async () => {
    renderTab()
    // 山田（スタッフ・空枠）の『写真を選ぶ』を開く
    const choose = buttons('写真を選ぶ').find((button) =>
      button.getAttribute('aria-label')?.includes('山田'),
    )
    expect(choose).toBeDefined()
    await act(async () => {
      choose!.click()
    })
    // 選ぶ窓の行そのものが選ぶ口（一覧の先頭が photo-used）。
    const pick = Array.from(
      document.body.querySelectorAll('button[role="option"]'),
    )[0] as HTMLButtonElement | undefined
    expect(pick).toBeDefined()
    expect(pick!.textContent).toContain('photo-used.png')
    await act(async () => {
      pick!.click()
    })
    expect(fixture.updateStaff).toHaveBeenCalledWith('account-a', 'staff-1', {
      photo_media_id: 'photo-used',
    })
  })

  it('写真付きの枠には『替える』『外す』が出て、外すと null が送られる', async () => {
    renderTab()
    expect(buttons('替える')).toHaveLength(1)
    const clear = buttons('外す')[0]
    await act(async () => {
      clear.click()
    })
    expect(fixture.updateMenu).toHaveBeenCalledWith(
      'account-a',
      'menu-1',
      expect.any(Number),
      expect.objectContaining({ photo_media_id: null }),
    )
  })

  it('権限がなければ選ぶ口も替え口も出ない', () => {
    renderTab({ canEditMenus: false, canEditSettings: false })
    expect(buttons('写真を選ぶ')).toHaveLength(0)
    expect(buttons('替える')).toHaveLength(0)
    expect(host.textContent).toContain('閲覧のみ')
  })
})
