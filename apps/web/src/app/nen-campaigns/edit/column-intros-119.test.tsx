// @vitest-environment happy-dom
/*
 * 119: コラムの紹介文。保存ボタンは副ボタンの形で、変えるまで薄く理由1行。
 * いつも同じ説明は題の下に出さず、題の横の「？」へ入れる。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/staff-role', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/staff-role')>()), useStaffRole: () => 'owner' }))
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
import { buttonByText, click, mount, setInputValue, settle, stubFetchNotFound, type Mounted } from '@/test-utils/race'

vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/nen-campaigns/edit',
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      nenCampaigns: {
        ...actual.api.nenCampaigns,
        columns: async () => ({ success: true, data: [{
          id: 'c1', externalId: null, slug: 'c1', title: '春のコラム', category: null, excerpt: '',
          introText: '元の紹介文', articleUrl: '', publishedAt: null, updatedAt: '2026-10-01T00:00:00Z',
        }] }),
      },
    },
  }
})

const { default: NenColumnEditPage } = await import('./page')

let view: Mounted
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubFetchNotFound()
  view = mount()
})
afterEach(async () => {
  await view.unmount()
  vi.unstubAllGlobals()
})

describe('コラムの紹介文（119）', () => {
  it('説明は題の下に出さず題の横の「？」に入れる', async () => {
    await view.render(<NenColumnEditPage />)
    await settle()
    // 題の下に説明の文は出ない。
    expect(view.host.textContent).not.toContain('前に付ける一言')
    // 題の横の「？」を押すと説明が読める。
    const help = view.host.querySelector('button[aria-label="コラムの紹介文の説明"]')
    expect(help).not.toBeNull()
    await click(help)
    await settle()
    expect(view.host.querySelector('[role="note"]')?.textContent).toContain('前に付ける一言')
  })

  it('保存は変えるまで薄く理由1行、変えたら押せる', async () => {
    await view.render(<NenColumnEditPage />)
    await settle()
    const save = buttonByText(view.host, '保存する')
    expect(save?.disabled).toBe(true)
    expect(view.host.textContent).toContain('変えたところはありません')
    const box = view.host.querySelector('textarea')
    expect(box).not.toBeNull()
    setInputValue(box!, '新しい紹介文')
    await settle()
    expect(buttonByText(view.host, '保存する')?.disabled).toBe(false)
    expect(view.host.textContent).not.toContain('変えたところはありません')
  })
})
