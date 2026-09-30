// @vitest-environment happy-dom
/*
 * ★V7 仕上げ §2「一括バー」。表で1件でも選ぶと下端から出る帯。
 * 0件では出さない・件数は濃い緑の太字・操作は白地ボタン。
 */
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Button from './button'
import BulkBar from './bulk-bar'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('一括バー（★V7 z97zZN §2）', () => {
  it('0件では出さない', () => {
    const { container } = render(<BulkBar count={0} />)
    expect(container.firstChild).toBeNull()
  })

  it('1件でも選ぶと「N件を選択中」と操作を出す', () => {
    const { container } = render(
      <BulkBar count={2}>
        <Button variant="secondary">タグを付ける</Button>
      </BulkBar>,
    )
    expect(container.textContent).toContain('2件を選択中')
    expect(container.textContent).toContain('タグを付ける')
  })

  it('単位は変えられる（人・枚）', () => {
    const { container } = render(<BulkBar count={3} unit="人" />)
    expect(container.textContent).toContain('3人を選択中')
  })

  it('0件へ戻ると少し待ってから消える（下がって消える）', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(<BulkBar count={2} />)
    expect(container.firstChild).not.toBeNull()
    rerender(<BulkBar count={0} />)
    // すぐには消えない（退場の動きの分だけ残る）
    expect(container.firstChild).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(container.firstChild).toBeNull()
  })
})
