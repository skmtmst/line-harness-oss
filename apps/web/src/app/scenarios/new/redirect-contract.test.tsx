// @vitest-environment happy-dom
/*
 * 対応表の `/scenarios/new` は作る①の正本 `/scenarios/mode` へ送る。
 */
import { describe, expect, test, vi } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'

const replace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('/scenarios/new は /scenarios/mode へ送る', () => {
  test('開いたら置き換えで送る', async () => {
    const { default: Page } = await import('./page')
    render(<Page />)
    expect(replace).toHaveBeenCalledWith('/scenarios/mode')
  })
})
