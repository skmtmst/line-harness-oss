// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Webinar, WebinarCtaCard, WebinarEditor } from '@/lib/api'
import VideoPane from '@/v8/webinar-edit/video'
import CtaPane from '@/v8/webinar-edit/cta'
import NotificationsPane from '@/v8/webinar-edit/notifications'
import linePreviewStyles from '@/components/shared/line-preview.module.css'
import { webinarEditContext, webinarWizardChrome } from '@/test-utils/webinar-edit'

const cards = vi.hoisted(() => ({ items: [] as WebinarCtaCard[] }))
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ accounts: [], loading: false }) }))
vi.mock('@/lib/api', async (original) => ({
  ...await original<typeof import('@/lib/api')>(),
  fetchApi: async () => ({ data: [] }),
  webinarApi: {
    videoAsset: async () => ({ data: { asset: null } }),
    ctas: async () => ({ data: cards.items }),
    notifications: async () => ({ data: { settings: null, overview: null } }),
    actions: async () => ({ data: [] }),
    editor: async () => ({ data: { version: 2 } }),
  },
}))

const noop = () => {}
const base = { id: 'webinar-1', title: '入力したウェビナー', videoPrefix: 'webinars/nen-start', durationSeconds: 2538, schedule: [] } as unknown as Webinar
const editor = { version: 2, actionPolicy: { missingResultPolicy: 'retry_next_day' }, publicPage: { form: null } } as WebinarEditor
const roots: Root[] = []
async function render(pane: 'video' | 'cta' | 'notifications', webinar = base, draft = editor) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  const Pane = { video: VideoPane, cta: CtaPane, notifications: NotificationsPane }[pane]
  await act(async () => root.render(<Pane ctx={webinarEditContext(webinar, draft, { readOnly: true })} chrome={webinarWizardChrome} onDirtyChange={noop} registerSave={noop} />))
  return { host, preview: host.querySelector<HTMLElement>('[data-template-region="preview"]')! }
}

describe('現役のプレビューの中身', () => {
  beforeEach(() => { cards.items = []; document.documentElement.dataset.theme = 'v8' })
  afterEach(() => {
    act(() => { for (const root of roots.splice(0)) root.unmount() })
    document.body.innerHTML = ''
    delete document.documentElement.dataset.theme
  })

  it('動画が設定されていれば、起きることを書く', async () => {
    const { host, preview } = await render('video')
    await act(async () => [...host.querySelectorAll('button')].find(button => button.getAttribute('aria-label')?.endsWith('の説明'))!.click())
    expect(host.textContent).toContain('視聴状況が友だちごとに記録されます')
    expect(preview.textContent).toContain(base.title)
    expect(preview.querySelector('svg')).not.toBeNull()
  })

  it('入力が無いときに、それらしい文を作らない', async () => {
    const { preview } = await render('video', { ...base, videoPrefix: null })
    expect(preview.textContent).toContain('動画を設定すると')
    expect(preview.textContent).not.toContain('いつでも見られます')
    expect(preview.querySelector('svg')).toBeNull()
  })

  it('CTAはボタンの文言をそのまま見せる', async () => {
    cards.items = [{ atSeconds: 0, kind: 'url', title: '相談', body: null, buttonLabel: '個別相談を予約する', autoOpen: false, formId: null, url: 'https://example.test' }]
    const { preview } = await render('cta')
    expect(preview.querySelector('[title="動画の下にボタンが出ます。"]')?.textContent).toBe('個別相談を予約する')
  })

  it('CTAが空ならボタンを出さない', async () => {
    cards.items = [{ atSeconds: 0, kind: 'url', title: '', body: null, buttonLabel: '   ', autoOpen: false, formId: null, url: '' }]
    const { preview } = await render('cta')
    expect(preview.querySelector('[title="動画の下にボタンが出ます。"]')).toBeNull()
    expect(preview.textContent).not.toContain('ボタン')
  })

  it('通知は実際に送る文をそのまま見せる', async () => {
    const { preview } = await render('notifications', base, { ...editor, notificationMessages: { dayBefore: '明日20:00に始まります' } } as WebinarEditor)
    expect(preview.querySelector(`[class~="${linePreviewStyles.bubble}"]`)?.textContent).toBe('明日20:00に始まります')
  })

  it('通知が空でも文を作らない', async () => {
    for (const value of [null, undefined, '   ']) {
      const { preview } = await render('notifications', base, { ...editor, notificationMessages: { dayBefore: value } } as WebinarEditor)
      expect(preview.querySelector(`[class~="${linePreviewStyles.bubble}"]`)).toBeNull()
      expect(preview.textContent).toContain('本文はまだありません')
    }
  })

  it('設計の見本文を固定値で置かない', async () => {
    const { preview } = await render('cta')
    expect(preview.textContent).not.toContain('個別相談を予約する')
    expect(preview.querySelector('[title="動画の下にボタンが出ます。"]')).toBeNull()
  })
})
