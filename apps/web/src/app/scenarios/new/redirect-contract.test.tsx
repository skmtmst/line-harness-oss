// @vitest-environment happy-dom
/*
 * 対応表の `/scenarios/new`。
 * - ★V8：送らずに、この URL で作る①（src/v8/scenarios/create.tsx・dnzqC）をそのまま出す。
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import React from 'react'

const replace = vi.fn()
let search = ''

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search),
}))
vi.mock('@/v8/scenarios/create', () => ({
  default: () => <p>V8 の作る①</p>,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  cleanup()
  replace.mockClear()
  search = ''
  delete document.documentElement.dataset.theme
})

describe('/scenarios/new', () => {

  test('★V8：送らずに作る①をこの URL で出す', async () => {
    document.documentElement.dataset.theme = 'v8'
    const { default: Page } = await import('./page')
    const view = render(<Page />)
    expect(await view.findByText('V8 の作る①')).toBeTruthy()
    expect(replace).not.toHaveBeenCalled()
  })
})
