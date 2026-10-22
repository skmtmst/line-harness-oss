// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

const createApi = vi.hoisted(() => vi.fn())
const updateApi = vi.hoisted(() => vi.fn())
const getApi = vi.hoisted(() => vi.fn())
const onStepChange = vi.hoisted(() => vi.fn())
const query = vi.hoisted(() => ({ value: '' }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const emptyList = async () => ({ success: true, data: [] })
  return {
    ...actual,
    api: {
      ...actual.api,
      broadcasts: {
        ...actual.api.broadcasts,
        create: createApi,
        update: updateApi,
        get: getApi,
        list: async () => ({ success: true, data: [] }),
        preflight: async () => ({ success: true, data: { audienceCount: 10 } }),
        previewCount: async () => ({ success: true, data: { count: 10 } }),
      },
      folders: { list: emptyList },
      scenarios: { list: emptyList },
      commonVars: { list: emptyList },
      friendFields: { list: emptyList },
      broadcastMessageAssets: { list: emptyList, upload: emptyList },
      templates: { list: emptyList },
      commonActions: { resources: async () => ({ success: true, data: [] }) },
      accountSettings: { getTestRecipients: async () => ({ success: true, data: [] }) },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/broadcasts/new',
  useSearchParams: () => new URLSearchParams(query.value),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', loading: false }),
}))

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import BroadcastForm from './broadcast-form'
import type { BroadcastStepKey } from './broadcast-steps'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true


let host: HTMLDivElement
let root: Root
const noop = () => {}
async function render(step: BroadcastStepKey | null, picker = false) {
  if (!host) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  }
  await act(async () => {
    root.render(<BroadcastForm tags={[]} onSuccess={noop} onCancel={noop}
      currentStep={step} onStepChange={onStepChange} openTemplatePickerInitially={picker} />)
    for (let i = 0; i < 12; i++) await Promise.resolve()
  })
}
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  host = undefined as unknown as HTMLDivElement
  query.value = ''
  getApi.mockReset()
  updateApi.mockReset()
})
const body = () => host.querySelector<HTMLElement>('[role="textbox"][placeholder="テキストを入力"]')
function setBody(value: string) {
  const input = body()!
  input.textContent = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
it('does not mount an unvisited editor, then retains the controlled body through previous/next steps', async () => {
  await render('basic')
  expect(host.querySelector('[data-message-composer]')).toBeNull()
  await render('audience')
  expect(host.querySelector('[data-message-composer]')).toBeNull()
  await render('message')
  expect(body()).toBeTruthy()
  await act(async () => setBody('前後の手順へ移っても残す本文'))
  await render('schedule')
  expect(host.querySelector('[data-message-composer]')).toBeTruthy()
  expect(body()?.textContent).toBe('前後の手順へ移っても残す本文')
  await render('basic')
  await render('message')
  expect(body()?.textContent).toBe('前後の手順へ移っても残す本文')
  expect(createApi).not.toHaveBeenCalled()
})
it('mounts a message deep link immediately and keeps the all-sections embedded form', async () => {
  await render('message')
  expect(body()).toBeTruthy()
  await render(null)
  expect(body()).toBeTruthy()
  expect(host.querySelector('#broadcast-step-basic')?.classList.contains('hidden')).toBe(false)
})
it('supports the initial template picker before the message URL update', async () => {
  await render('basic', true)
  expect(host.querySelector('[data-message-composer]')).toBeTruthy()
  expect(document.body.textContent).toContain('テンプレートを選ぶ')
})

function draft(over: Record<string, unknown> = {}) {
  return {
    id: 'draft-1', lineAccountId: 'acc-1', title: '保存済みの題',
    messageType: 'text', messageContent: '遅れて復元する本文', messageBubbles: null,
    targetType: 'all', targetTagId: null, segmentConditions: null, scheduledAt: null,
    status: 'draft', draftStep: 'schedule', draftPayload: null, messageOptions: null,
    afterActionVersionId: null, trackLinks: false, version: 7, ...over,
  }
}
function save() {
  const button = [...host.querySelectorAll('button')].find(el => el.textContent?.includes('下書きを保存する'))!
  button.click()
}
async function paint() {
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)) })
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)) })
}
it('restores a delayed draft before first visit and keeps it after a rejected save', async () => {
  query.value = 'draft=draft-1&step=schedule'
  let resolve!: (value: unknown) => void
  getApi.mockReturnValue(new Promise(done => { resolve = done }))
  await render('schedule')
  expect(body()).toBeNull()
  await act(async () => { resolve({ success: true, data: draft() }) })
  await render('schedule')
  expect(body()).toBeNull()
  await render('message')
  expect(body()?.textContent).toBe('遅れて復元する本文')
  updateApi.mockResolvedValue({ success: false, error: '保存を試し直してください' })
  await act(async () => save())
  expect(updateApi).toHaveBeenCalledWith('draft-1', expect.objectContaining({ expectedVersion: 7 }))
  expect(createApi).not.toHaveBeenCalled()
  expect(host.textContent).toContain('保存を試し直してください')
  await render('schedule')
  await render('message')
  expect(body()?.textContent).toBe('遅れて復元する本文')
})
it.each(['body', 'buttons'])('reveals and focuses an unvisited invalid %s from another step', async invalid => {
  query.value = 'draft=draft-1&step=schedule'
  getApi.mockResolvedValue({ success: true, data: draft(invalid === 'body'
    ? { messageContent: '' }
    : { messageOptions: { buttons: [{ type: 'url', label: '', value: 'https://example.invalid' }] } }) })
  await render('schedule')
  expect(body()).toBeNull()
  await act(async () => save())
  expect(onStepChange).toHaveBeenCalledWith('message')
  await render('message')
  await paint()
  if (invalid === 'body') {
    expect(host.querySelector('[aria-label="1通目の吹き出し"]')?.contains(document.activeElement)).toBe(true)
  } else {
    const settings = [...host.querySelectorAll('details')].find(el => el.textContent?.includes('ほかの設定'))!
    expect(settings.open).toBe(true)
    expect(settings.contains(document.activeElement)).toBe(true)
  }
  expect(updateApi).not.toHaveBeenCalled()
  expect(createApi).not.toHaveBeenCalled()
})
