import { afterEach, expect, it, vi } from 'vitest'
import { GET } from './route'

afterEach(() => vi.unstubAllEnvs())

it('ログインなしで完全なSHAと公開情報だけを返す', async () => {
  vi.stubEnv('APP_COMMIT_SHA_FULL', 'a'.repeat(40))
  vi.stubEnv('APP_VERSION', '0.24.0')
  vi.stubEnv('APP_BUILD_TIME', '2026-10-09T00:00:00Z')
  vi.stubEnv('ADMIN_API_KEY', 'must-not-leak')
  expect(await GET().json()).toEqual({
    git_commit: 'a'.repeat(40), version: '0.24.0', released_at: '2026-10-09T00:00:00Z',
  })
})
