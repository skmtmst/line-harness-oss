// @vitest-environment happy-dom
import { act, renderHook, cleanup } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { useMenuMediaScope } from '../../../v8/rich-menus/new/use-menu-media-scope'
import type { PendingImage } from '../../../v8/rich-menus/new/create-types'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('別店舗へ替えると画像のURLを解放して選択窓を閉じ、同じ店舗の再描画では入力を保つ', () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const { result, rerender } = renderHook(({ id, hosted }) => {
    const [images, setImages] = useState<Array<PendingImage | null>>([])
    const [open, setOpen] = useState(false)
    useMenuMediaScope(id, hosted, setImages, setOpen)
    return { images, setImages, open, setOpen }
  }, { initialProps: { id: 'store-a', hosted: false } })
  act(() => { result.current.setImages([{ url: 'blob:store-a' } as PendingImage, null]); result.current.setOpen(true) })
  rerender({ id: 'store-a', hosted: false })
  expect(result.current.images).toHaveLength(2)
  expect(result.current.open).toBe(true)
  expect(revoke).not.toHaveBeenCalled()
  rerender({ id: 'store-b', hosted: false })
  expect(result.current.images).toEqual([])
  expect(result.current.open).toBe(false)
  expect(revoke).toHaveBeenCalledWith('blob:store-a')
  act(() => { result.current.setImages([{ url: 'blob:hq' } as PendingImage]); result.current.setOpen(true) })
  rerender({ id: 'store-c', hosted: true })
  expect(result.current.images).toHaveLength(1)
  expect(result.current.open).toBe(true)
  expect(revoke).toHaveBeenCalledTimes(1)
})
