// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EnvironmentFeatureGate from './environment-feature-gate'
import RestaurantTestLayout from '@/app/restaurant-test/layout'
import { PREPARING_TITLE } from './preparing-dialog'

const fixture = vi.hoisted(() => ({ path: '/restaurant-test/delivery', replace: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => fixture.path, useRouter: () => ({ replace: fixture.replace }) }))
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.clearAllMocks() })

function configure(environment: 'production' | 'staging') {
  const source = readFileSync(new URL(environment === 'production' ? '../../../../worker/wrangler.toml' : '../../../../worker/wrangler.staging.toml', import.meta.url), 'utf8')
  for (const name of ['GOOGLE_BUSINESS_ENABLED', 'RESTAURANT_TEST_ENABLED']) {
    vi.stubEnv(`NEXT_PUBLIC_${name}`, source.match(new RegExp(`^${name} = "([^"]+)"`, 'm'))![1])
  }
}

describe("本番・検証の実際の設定で画面を出す", () => {
  it.each(['production', 'staging'] as const)('%s でGoogleは開き、飲食店と設定は公開状態に従う', environment => {
    configure(environment)
    for (const path of ['/restaurant-test/google', '/restaurant-test/delivery', '/restaurant-test/stores/new', '/settings/delivery', '/settings/booking-media']) {
      fixture.path = path
      const content = vi.fn(() => <p>機能の中身</p>)
      const Content = content
      render(path.startsWith('/restaurant-test')
        ? <RestaurantTestLayout><Content /></RestaurantTestLayout>
        : <EnvironmentFeatureGate feature="対象機能"><Content /></EnvironmentFeatureGate>)
      const opened = environment === 'staging' || path === '/restaurant-test/google'
      expect(Boolean(screen.queryByText('機能の中身'))).toBe(opened)
      expect(content.mock.calls.length > 0).toBe(opened)
      expect(Boolean(screen.queryByRole('dialog', { name: PREPARING_TITLE }))).toBe(!opened)
      if (!opened) { fireEvent.click(screen.getAllByRole('button', { name: '閉じる' }).at(-1)!); expect(fixture.replace).toHaveBeenCalledWith('/hq') }
      cleanup()
    }
  })
})
