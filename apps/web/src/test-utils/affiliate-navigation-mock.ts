import { beforeEach, vi } from 'vitest'

export const affiliateNavigation = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }

beforeEach(() => {
  window.history.replaceState(null, '', '/affiliates')
  window.dispatchEvent(new Event('popstate'))
  vi.clearAllMocks()
})

export function affiliateNavigationMock() {
  return { useRouter: () => affiliateNavigation, usePathname: () => '/affiliates', useSearchParams: () => new URLSearchParams(window.location.search) }
}
