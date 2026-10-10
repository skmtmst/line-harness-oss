import { vi } from 'vitest'

/** 単独画面の試験用の既定。試験固有のURL・移動の記録は呼び出し元で上書きする。 */
export function navigationMock() {
  return {
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => typeof window === 'undefined' ? '/' : window.location.pathname,
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  }
}
