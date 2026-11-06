// @vitest-environment happy-dom
import { act } from 'react'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { forgetStaffIdentity } from '@/lib/staff-identity-state'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/* Googleビジネス投稿の一覧：種類の札（最新情報・イベント・特典）は全部同じ chip。 */

const postsMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/restaurant-google-api', async (importOriginal: () => Promise<typeof import('@/lib/restaurant-google-api')>) => {
  const actual = await importOriginal()
  return { ...actual, restaurantGoogleApi: { ...actual.restaurantGoogleApi, posts: postsMock } }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/restaurant-test/google',
}))

const { PostsBoard } = await import('@/v8/restaurant/google/posts')

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const post = (id: string, kind: 'standard' | 'event' | 'offer') => ({
  id, kind, origin: 'musubo', summary: `${id}の概要`, title: null, schedule: null, cta: null, offer: null, media: [],
  instagram: null, publishMode: 'now', status: 'published', googleState: null, searchUrl: null, staffName: null,
  error: null, createdAt: '2026-09-01T00:00:00.000+09:00', sentAt: null, publishedAt: '2026-09-02T00:00:00.000+09:00',
  updatedAt: '2026-09-02T00:00:00.000+09:00',
})

beforeEach(() => {
  verifiedStaffRole('owner')
  document.documentElement.dataset.theme = 'v8'
  postsMock.mockResolvedValue({
    success: true, posts: [post('p1', 'standard'), post('p2', 'event'), post('p3', 'offer')],
    page: 1, perPage: 20, total: 3,
    counts: { all: 3, draft: 0, published: 3, attention: 0, scheduled: 0 },
    writeEnabled: true, permissions: { canPublish: true },
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  forgetStaffIdentity()
  delete document.documentElement.dataset.theme
})

async function settle() {
  for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve() })
}

describe('投稿の種類の札', () => {
  it('最新情報・イベント・特典が全部同じ見た目の chip', async () => {
    await act(async () => {
      root.render(<PostsBoard accountId="account-1" go={() => undefined} />)
      await settle()
    })
    const rows = Array.from(container.querySelectorAll('[class*="postRow"]'))
    expect(rows).toHaveLength(3)
    const chips = rows.map((row) => row.querySelector('span[class*="chip"]') as HTMLElement)
    expect(chips.map((chip) => chip.textContent)).toEqual(['最新情報', 'イベント', '特典'])
    // 全部同じ class（色違いの札を混ぜない）。
    const classes = new Set(chips.map((chip) => chip.className))
    expect(classes.size).toBe(1)
  })
})
