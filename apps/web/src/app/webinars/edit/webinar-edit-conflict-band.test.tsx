// @vitest-environment happy-dom
/*
 * 同時編集の帯（板 ）。409 の見分けと帯の表示だけを確かめる。
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { SaveConflictBand } from '@/components/shared/save-conflict'
import { isConflict } from '@/v8/webinar-edit/cta'

// globals: false のため Testing Library の自動 cleanup は登録されない。
afterEach(async () => {
  await act(async () => cleanup())
})

const latestEditor = { version: 3 } as never

function conflictError(): ApiError {
  return new ApiError(409, 'ほかの人が先に変えました', 'VERSION_CONFLICT', { latest: latestEditor }, null, null)
}

describe('isConflict', () => {
  it('409 の同時編集だけを見分ける', () => {
    expect(isConflict(conflictError())).toBe(true)
  })

  it('ふつうの失敗を競合と混ぜず、返事にある不正な最新を信頼せず読む', () => {
    expect(isConflict(new Error('落ちた'))).toBe(false)
    expect(isConflict(new ApiError(500, '失敗', undefined, null, null, null))).toBe(false)
    expect(
      isConflict(new ApiError(409, '競合', 'VERSION_CONFLICT', { latest: { version: 'x' } }, null, null)),
    ).toBe(true)
  })
})

describe('WebinarEditConflictBand', () => {
  it('帯に文と最新を読み込む口を出す', () => {
    const onReload = vi.fn()
    render(
      <SaveConflictBand
        title="ほかの人が先に保存しました"
        compareBusy={false}
        onReload={onReload}
      />,
    )
    expect(screen.getByText('ほかの人が先に保存しました')).toBeTruthy()
    const button = screen.getByRole('button', { name: '最新を読み込んで続ける' })
    button.click()
    expect(onReload).toHaveBeenCalledTimes(1)
  })
})
