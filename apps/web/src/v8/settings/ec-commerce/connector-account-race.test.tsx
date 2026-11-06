// @vitest-environment happy-dom
/*
 * 監査 WEB192：つなぎ先の設定で、B に切り替えたあとに A の遅い応答が届いても、
 * A の設定を B の欄へ入れない。
 */
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const fx = vi.hoisted(() => ({ pending: new Map<string, (v: unknown) => void>() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/settings',
}))
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, api: { ...actual.api, ecCommerce: { ...actual.api.ecCommerce, connector: (accountId: string) => new Promise((resolve) => { fx.pending.set(accountId, resolve) }) } } }
})
import EcConnector from './connector'
afterEach(cleanup)

const overview = (domain: string) => ({
  success: true,
  data: {
    configured: true,
    health: { status: 'ok' },
    connector: { provider: 'shopify', shopDomain: domain, status: 'connected', eventTypes: [], identityRules: [], version: 1 },
  },
})

it('B に切り替えたあとに A の応答が届いても、B のつなぎ先のまま', async () => {
  const view = render(<EcConnector accountId="acc-a" />)
  view.rerender(<EcConnector accountId="acc-b" />)
  await act(async () => { fx.pending.get('acc-b')?.(overview('b-shop.myshopify.com')) })
  await act(async () => { fx.pending.get('acc-a')?.(overview('a-shop.myshopify.com')) })
  const input = document.querySelector('#ec-connector-domain') as HTMLInputElement | null
  expect(input?.value).toBe('b-shop.myshopify.com')
})
