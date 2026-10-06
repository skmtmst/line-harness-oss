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
  editor: vi.fn(),
  saveEditor: vi.fn(),
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
      editor: apiMocks.editor,
      saveEditor: apiMocks.saveEditor,
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

const roots: Root[] = []
function render(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root: Root = createRoot(host)
  roots.push(root)
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
    apiMocks.editor.mockResolvedValue({ data: EDITOR })
    apiMocks.actions.mockResolvedValue({ data: [] })
    apiMocks.saveNotifications.mockImplementation(async (_id: string, input: Record<string, unknown>) => ({
      data: { settings: { ...SETTINGS, ...input }, queued: 0, cancelled: 0 },
    }))
  })

  afterEach(() => {
    act(() => { for (const root of roots.splice(0)) root.unmount() })
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

  it('入り切りの入力を残し、下書き保存したときだけ保存する', async () => {
    const host = render()
    await act(async () => undefined)
    const toggle = host.querySelector('button[role="switch"][aria-label="申込のお礼"]')
    expect(toggle).not.toBeNull()
    await act(async () => {
      toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(apiMocks.saveNotifications).not.toHaveBeenCalled()
    await act(async () => { [...host.querySelectorAll('button')].find((el) => el.textContent === '下書きを保存')!.click() })
    expect(apiMocks.saveNotifications).toHaveBeenCalledTimes(1)
    const input = apiMocks.saveNotifications.mock.calls[0][1] as { registrationEnabled: boolean }
    expect(input.registrationEnabled).toBe(false)
  })
  it('下書き保存に失敗してもスイッチの入力を残して再試行できる', async () => {
    apiMocks.saveNotifications.mockRejectedValueOnce(new Error('network'))
    const host = render()
    await act(async () => undefined)
    const toggle = host.querySelector('button[role="switch"][aria-label="申込のお礼"]') as HTMLButtonElement
    await act(async () => { toggle.click() })
    const save = [...host.querySelectorAll('button')].find((el) => el.textContent === '下書きを保存')!
    await act(async () => { save.click() })
    expect(host.textContent).toContain('入力を残しました')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(apiMocks.saveNotifications).toHaveBeenCalledTimes(1)
    await act(async () => { save.click() })
    expect(apiMocks.saveNotifications).toHaveBeenCalledTimes(2)
    expect(apiMocks.saveNotifications.mock.calls[1][1].registrationEnabled).toBe(false)
  })

})
