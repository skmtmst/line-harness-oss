// @vitest-environment happy-dom
/*
 * ★V8 公開の前に確かめる（`XCUNf`）の描画。
 * 差し替えるのは通信だけ。検査の一覧・まとめ・公開ボタンが実在する。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  publishValidation: vi.fn(),
  notifications: vi.fn(),
  publish: vi.fn(),
  testPublicPage: vi.fn(),
  role: 'admin',
}))

vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => apiMocks.role, canManageRole: (role: string) => role === 'owner' || role === 'admin' }))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    webinarApi: {
      publishValidation: apiMocks.publishValidation,
      notifications: apiMocks.notifications,
      publish: apiMocks.publish,
      testPublicPage: apiMocks.testPublicPage,
    },
  }
})

import ReviewV8 from './review-v8'
import type { Webinar, WebinarEditor } from '@/lib/api'

const WEBINAR = {
  id: 'webinar-1',
  title: 'NEN活用スタートセミナー',
  status: 'draft',
  videoPrefix: 'videos/nen-start.mp4',
  schedule: [{ type: 'daily', time: '10:00' }],
  cta: null,
  publicationState: 'unset',
  publicationStartsAt: '2026-10-01T10:00:00+09:00',
  publicationEndsAt: null,
} as unknown as Webinar

const EDITOR = {
  version: 4,
  monitoring: { notificationFailures: 0, viewSegmentFailures: 0, actionFailures: 0 },
} as unknown as WebinarEditor

let mounted: Root[] = []

function render(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root: Root = createRoot(host)
  mounted.push(root)
  act(() => {
    root.render(
      <ReviewV8
        webinar={WEBINAR}
        editor={EDITOR}
        registrations={124}
        ctaCount={2}
        onPublished={() => undefined}
        onTestNotifications={() => undefined}
      />,
    )
  })
  return host
}

describe('公開の前に確かめるのV8（XCUNf）', () => {
  beforeEach(() => {
    apiMocks.role = 'admin'
    apiMocks.publishValidation.mockResolvedValue({
      data: {
        checks: [
          { key: 'video', label: '動画の準備ができている', status: 'passed', detail: '' },
          { key: 'page', label: '公開ページを確かめた', status: 'failed', detail: 'ページをテストしてください' },
        ],
      },
    })
    apiMocks.notifications.mockResolvedValue({
      data: {
        settings: {
          registrationEnabled: true,
          dayBeforeEnabled: true,
          hourBeforeEnabled: false,
          startEnabled: false,
          missedEnabled: false,
          completedEnabled: false,
        },
      },
    })
  })

  afterEach(() => {
    act(() => { mounted.forEach((root) => root.unmount()); mounted = [] })
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('板IDと検査の一覧・まとめ・公開ボタンを描く', async () => {
    const host = render()
    await act(async () => undefined)
    expect(host.querySelector('[data-design-node="XCUNf"]')).not.toBeNull()
    expect(host.textContent).toContain('公開前の確認')
    expect(host.textContent).toContain('1/2')
    expect(host.textContent).toContain('できた')
    expect(host.textContent).toContain('まだ')
    expect(host.textContent).toContain('設定のまとめ')
    expect(host.textContent).toContain('この版を公開')
  })

  it('通っていないと公開ボタンを押せない', async () => {
    const host = render()
    await act(async () => undefined)
    const publish = [...host.querySelectorAll('button')].find((el) => el.textContent === 'この版を公開')
    expect((publish as HTMLButtonElement).disabled).toBe(true)
    expect(apiMocks.publish).not.toHaveBeenCalled()
  })

  it('閲覧のみでは検査結果を読み、合格していても公開・テストを止める', async () => {
    apiMocks.role = 'staff'
    apiMocks.publishValidation.mockResolvedValue({ data: { checks: [{ key: 'page', label: '公開ページ', status: 'passed' }] } })
    const host = render()
    await act(async () => undefined)
    expect(host.textContent).toContain('1/1')
    expect(host.textContent).toContain('閲覧のみ')
    for (const label of ['この版を公開', 'ページをテスト', '通知のテストを送る']) {
      const button = [...host.querySelectorAll('button')].find((element) => element.textContent === label)!
      expect(button.disabled).toBe(true)
      await act(async () => { button.click() })
    }
    expect(apiMocks.publish).not.toHaveBeenCalled()
    expect(apiMocks.testPublicPage).not.toHaveBeenCalled()
  })

  it('ページのテスト後は更新された保存版で公開し、二重クリックを一回にする', async () => {
    apiMocks.publishValidation.mockResolvedValue({ data: { checks: [{ key: 'page', label: '公開ページ', status: 'passed' }] } })
    apiMocks.testPublicPage.mockResolvedValue({ data: { ...EDITOR, version: 5, publicPage: { test: { status: 'passed' } } } })
    let reject!: (error: Error) => void
    apiMocks.publish.mockReturnValue(new Promise((_resolve, rejectPromise) => { reject = rejectPromise }))
    const host = render()
    await act(async () => undefined)
    const button = (label: string) => [...host.querySelectorAll('button')].find((element) => element.textContent === label)!
    await act(async () => { button('ページをテスト').click() })
    expect(apiMocks.testPublicPage).toHaveBeenCalledWith('webinar-1', 4)
    await act(async () => { button('この版を公開').click(); button('この版を公開').click() })
    expect(apiMocks.publish).toHaveBeenCalledTimes(1)
    expect(apiMocks.publish).toHaveBeenCalledWith('webinar-1', 5)
    await act(async () => { reject(new Error('通信切れ')) })
    expect(host.textContent).toContain('公開できませんでした')
    expect((button('この版を公開') as HTMLButtonElement).disabled).toBe(false)
  })

})
