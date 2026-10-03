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
}))

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

function render(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root: Root = createRoot(host)
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
})
