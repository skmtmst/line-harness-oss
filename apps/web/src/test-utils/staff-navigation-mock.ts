import { vi } from 'vitest'
export function staffTestRouter() {
  const navigate = (url: string) => {
    window.history.pushState(null, '', url)
    window.dispatchEvent(new Event('popstate'))
  }
  return { push: vi.fn(navigate), replace: vi.fn(navigate), back: vi.fn(), prefetch: vi.fn() }
}
