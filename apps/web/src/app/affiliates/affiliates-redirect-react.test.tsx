// @vitest-environment happy-dom
/*
 * /affiliates → /conversions へのリダイレクト (#1058)。
 *
 * 実物の React をマウントして、useSearchParams の ?tab= が router.replace の
 * 行き先へ残ることを確かめる。ソース検査だけでは「文字列を組み立てて渡した」
 * ことまでは固定できない。
 */
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'

const fixture = vi.hoisted(() => ({
  replace: vi.fn(),
  search: '',
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: fixture.replace }),
  useSearchParams: () => new URLSearchParams(fixture.search),
}))

const { default: AffiliatesPage } = await import('./page')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  cleanup()
  fixture.replace.mockClear()
  fixture.search = ''
})

describe('/affiliates のリダイレクト (#1058)', () => {
  it('?tab=offers は /conversions?tab=offers へ渡す（/affiliate-offers からの経路）', async () => {
    fixture.search = 'tab=offers'
    render(<AffiliatesPage />)
    await waitFor(() =>
      expect(fixture.replace).toHaveBeenCalledWith('/conversions?tab=offers'),
    )
  })

  it('tab無しは「アフィリエイター」タブを開く（成果地点へは落とさない）', async () => {
    fixture.search = ''
    render(<AffiliatesPage />)
    await waitFor(() =>
      expect(fixture.replace).toHaveBeenCalledWith('/conversions?tab=affiliates'),
    )
  })

  it('/conversions に無いtab名は「アフィリエイター」タブへ倒す', async () => {
    fixture.search = 'tab=nonsense'
    render(<AffiliatesPage />)
    await waitFor(() =>
      expect(fixture.replace).toHaveBeenCalledWith('/conversions?tab=affiliates'),
    )
  })

  it('/conversions が持つ別タブ（支払い）はそのまま渡す', async () => {
    fixture.search = 'tab=payment'
    render(<AffiliatesPage />)
    await waitFor(() =>
      expect(fixture.replace).toHaveBeenCalledWith('/conversions?tab=payment'),
    )
  })
})
