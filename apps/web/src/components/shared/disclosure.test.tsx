// @vitest-environment happy-dom
/* 開閉する欄（★V7 `v9M8P8`）。中身はネイティブの details/summary。 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import Disclosure from './disclosure'

afterEach(() => cleanup())

describe('開閉する欄（★V7）', () => {
  it('details/summary で、閉じている時は要約を出す', () => {
    const { container } = render(<Disclosure title="配信の詳細設定" hint="3項目"><p>中身</p></Disclosure>)
    const details = container.querySelector('details')!
    expect(details.open).toBe(false)
    expect(container.querySelector('summary')!.textContent).toContain('配信の詳細設定')
    expect(container.querySelector('summary')!.textContent).toContain('3項目')
  })

  it('defaultOpen で開いた状態から始まる', () => {
    const { container } = render(<Disclosure title="詳細" defaultOpen><p>中身</p></Disclosure>)
    expect(container.querySelector('details')!.open).toBe(true)
  })
})
