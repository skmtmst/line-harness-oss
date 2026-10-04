// @vitest-environment happy-dom
/*
 * 同時編集の帯（板 `pvimJ`）。409 の見分けと帯の表示だけを確かめる。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import WebinarEditConflictBand, { extractEditConflict } from './webinar-edit-conflict-band'

const latestEditor = { version: 3 } as never

function conflictError(): ApiError {
  return new ApiError(409, 'ほかの人が先に変えました', 'VERSION_CONFLICT', { latest: latestEditor }, null, null)
}

describe('extractEditConflict', () => {
  it('409 の同時編集だけ最新を取り出す', () => {
    expect(extractEditConflict(conflictError())).toEqual({ latest: latestEditor })
  })

  it('ふつうの失敗・版でない最新は帯を出さない', () => {
    expect(extractEditConflict(new Error('落ちた'))).toBeNull()
    expect(extractEditConflict(new ApiError(500, '失敗', undefined, null, null, null))).toBeNull()
    expect(
      extractEditConflict(new ApiError(409, '競合', 'VERSION_CONFLICT', { latest: { version: 'x' } }, null, null)),
    ).toEqual({ latest: null })
  })
})

describe('WebinarEditConflictBand', () => {
  it('帯に文と最新を読み込む口を出す', () => {
    const onReload = vi.fn()
    render(
      <WebinarEditConflictBand
        message="ほかの人が先に保存しました"
        reloading={false}
        onReload={onReload}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('ほかの人が先に保存しました')).toBeTruthy()
    const button = screen.getByRole('button', { name: '最新を読み込む' })
    button.click()
    expect(onReload).toHaveBeenCalledTimes(1)
  })
})
