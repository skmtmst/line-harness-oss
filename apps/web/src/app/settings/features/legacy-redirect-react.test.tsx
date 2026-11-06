// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Page from './page'

const replace = vi.fn()
vi.mock('@/components/shared/list-navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/shared/list-navigation')>()
  return { ...actual, useListNavigationRouter: () => ({ replace }) }
})

afterEach(cleanup)

/** B21：古い住所 /settings/features は今の /settings へ送る。 */
it('古い住所を開くと機能設定へ送る', async () => {
  render(<Page />)
  expect(document.querySelector('[data-page-pending="route"]')).toBeTruthy()
  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/settings'))
})
