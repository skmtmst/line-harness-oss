// @vitest-environment happy-dom
/*
 * 監査 W159：送り先 A を直している途中で送り先 B へ移り、B の読み込みが
 * 終わる前に保存を押しても、A の入力で B を更新しない。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buttonByText, click, mount, settle, stubFetchNotFound, type Mounted } from '@/test-utils/race'

const fixture = vi.hoisted(() => ({ id: 'wh-a', update: vi.fn() }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(`id=${fixture.id}`),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/webhooks/edit',
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', loading: false }),
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: () => Promise.resolve({ success: true, data: { role: 'owner' } }) },
      webhooks: {
        ...actual.api.webhooks,
        outgoing: {
          ...actual.api.webhooks.outgoing,
          detail: (id: string) => id === 'wh-a'
            ? Promise.resolve({ success: true, data: { name: 'A の送り先', url: 'https://a.example', eventTypes: ['*'], maxRetries: 1 } })
            : new Promise(() => undefined),
          update: fixture.update,
        },
      },
    },
  }
})

const { default: EditWebhookPage } = await import('./page')

let view: Mounted
beforeEach(() => {
  fixture.id = 'wh-a'
  fixture.update.mockReset()
  fixture.update.mockResolvedValue({ success: true, data: {} })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubFetchNotFound()
  view = mount()
})
afterEach(async () => {
  await view.unmount()
  vi.unstubAllGlobals()
})

describe('送り先の編集（W159）', () => {
  it('B を読み込み中は、A の入力で保存しない', async () => {
    await view.render(<EditWebhookPage />)
    await settle()
    expect(view.host.querySelector<HTMLInputElement>('#wh-edit-name')?.value).toBe('A の送り先')
    fixture.id = 'wh-b'
    await view.render(<EditWebhookPage />)
    await settle()
    await click(buttonByText(view.host, '保存する'))
    await settle()
    expect(fixture.update).not.toHaveBeenCalled()
  })

  it('読み込みが済んだ送り先は保存できる（対照）', async () => {
    await view.render(<EditWebhookPage />)
    await settle()
    await click(buttonByText(view.host, '保存する'))
    await settle()
    expect(fixture.update).toHaveBeenCalledWith('wh-a', 'acc-1', expect.objectContaining({ name: 'A の送り先' }))
  })
})
