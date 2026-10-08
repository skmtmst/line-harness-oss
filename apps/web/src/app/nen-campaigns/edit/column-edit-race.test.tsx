// @vitest-environment happy-dom
/*
 * 監査 PKG109：コラムの紹介文の編集で、アカウントを切り替えたあとに
 * 前のアカウントの遅い応答が一覧と入力を置き換えない。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, settle, stubFetchNotFound, type Mounted } from '@/test-utils/race'

const fixture = vi.hoisted(() => ({
  account: 'account-a',
  pending: new Map<string, (value: unknown) => void>(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/nen-campaigns/edit',
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.account, loading: false }),
}))
vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => 'v7' }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      nenCampaigns: {
        ...actual.api.nenCampaigns,
        columns: (accountId: string) => new Promise((resolve) => { fixture.pending.set(accountId, resolve) }),
      },
    },
  }
})

const { default: NenColumnEditPage } = await import('./page')

const column = (id: string, title: string) => ({
  id, externalId: null, slug: id, title, category: null, excerpt: '', introText: `${title}の紹介`,
  articleUrl: '', publishedAt: null, updatedAt: '2026-10-01T00:00:00Z',
})

let view: Mounted
beforeEach(() => {
  fixture.account = 'account-a'
  fixture.pending.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubFetchNotFound()
  view = mount()
})
afterEach(async () => {
  await view.unmount()
  vi.unstubAllGlobals()
})

describe('コラムの紹介文（PKG109）', () => {
  it('B に切り替えたあとに A の応答が届いても、B のコラムのまま', async () => {
    await view.render(<NenColumnEditPage />)
    await settle()
    fixture.account = 'account-b'
    await view.render(<NenColumnEditPage />)
    await settle()
    fixture.pending.get('account-b')?.({ success: true, data: [column('b1', 'Bのコラム')] })
    await settle()
    fixture.pending.get('account-a')?.({ success: true, data: [column('a1', 'Aのコラム')] })
    await settle()
    expect(view.host.textContent).toContain('Bのコラム')
    expect(view.host.textContent).not.toContain('Aのコラム')
  })
})
