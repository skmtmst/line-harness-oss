import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

it.each([
  { configured: undefined, expected: null, prelogin: 'https://musubo.jp/contact/' },
  { configured: '', expected: null, prelogin: 'https://musubo.jp/contact/' },
  { configured: '   ', expected: null, prelogin: '   ' },
  { configured: 'https://support.example.test/contact/', expected: 'https://support.example.test/contact/', prelogin: 'https://support.example.test/contact/' },
])('指定連絡先=$configured、ログイン前の既定値は変えない', async ({ configured, expected, prelogin }) => {
  vi.stubEnv('NEXT_PUBLIC_CONTACT_URL', configured)
  vi.resetModules()
  const links = await import('./auth-email')
  expect(links.CONFIGURED_CONTACT_URL).toBe(expected)
  expect(links.CONTACT_URL).toBe(prelogin)
})
