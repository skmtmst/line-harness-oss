// @vitest-environment happy-dom
/*
 * ★V8 通知と視聴後のこと（`E7iAYs`）の描画。
 * 差し替えるのは通信だけ。入り切りの段・実績・視聴後の段が実在する。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  notifications: vi.fn(),
  saveNotifications: vi.fn(),
  testNotifications: vi.fn(),
  actions: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    webinarApi: {
      notifications: apiMocks.notifications,
      saveNotifications: apiMocks.saveNotifications,
      testNotifications: apiMocks.testNotifications,
      actions: apiMocks.actions,
    },
  }
})

import NotificationsV8 from './notifications-v8'
import type { WebinarEditor } from '@/lib/api'

const SETTINGS = {
  registrationEnabled: true,
  dayBeforeEnabled: true,
  dayBeforeTime: '19:00',
  hourBeforeEnabled: true,
  hourBeforeMinutes: 15,
  startEnabled: true,
  missedEnabled: false,
  missedTime: '10:00',
  missedWindowDays: 3,
  completedEnabled: true,
}

const EDITOR = { version: 2, notificationTest: null } as unknown as WebinarEditor

function render(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root: Root = createRoot(host)
  act(() => {
    root.render(
      <NotificationsV8
        webinarId="webinar-1"
        webinarTitle="NEN活用スタートセミナー"
        editor={EDITOR}
        onOpenActions={() => undefined}
      />,
    )
  })
  return host
}

describe('通知と視聴後のことのV8（E7iAYs）', () => {
  beforeEach(() => {
    apiMocks.notifications.mockResolvedValue({
      data: { settings: SETTINGS, overview: { total: 423, sent: 412, failed: 3, skipped: 8 } },
    })
    apiMocks.actions.mockResolvedValue({ data: [] })
    apiMocks.saveNotifications.mockImplementation(async (_id: string, input: Record<string, unknown>) => ({
      data: { settings: { ...SETTINGS, ...input }, queued: 0, cancelled: 0 },
    }))
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('板IDと通知の段・実績・視聴後の段を描く', async () => {
    const host = render()
    await act(async () => undefined)
    expect(host.querySelector('[data-design-node="E7iAYs"]')).not.toBeNull()
    for (const label of ['通知とリマインド', '視聴後にすること', 'LINEでの見え方']) {
      expect(host.textContent).toContain(label)
    }
    expect(host.textContent).toContain('412')
    expect(host.textContent).toContain('申込のお礼')
    expect(host.textContent).toContain('視聴完了')
  })

  it('入り切りを押すとその場で保存する', async () => {
    const host = render()
    await act(async () => undefined)
    const toggle = host.querySelector('button[role="switch"][aria-label="申込のお礼"]')
    expect(toggle).not.toBeNull()
    await act(async () => {
      toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(apiMocks.saveNotifications).toHaveBeenCalledTimes(1)
    const input = apiMocks.saveNotifications.mock.calls[0][1] as { registrationEnabled: boolean }
    expect(input.registrationEnabled).toBe(false)
  })
})
