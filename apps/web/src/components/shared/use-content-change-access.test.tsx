// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useContentChangeAccess, type ContentChangeAccess } from './use-content-change-access'
afterEach(cleanup)

it('未指定は操作を変えず、拒否理由もnative disabledも作らない', () => {
  const { result } = renderHook(() => useContentChangeAccess({}))
  expect(result.current.provided).toBe(false); expect(result.current.blocked).toBe(false); expect(result.current.disabled).toBe(false)
  expect(result.current.lockedReason).toBeUndefined(); expect(result.current.canChangeNow()).toBe(true)
})
it('理由はcallbackの許可より優先し、既知理由と未知disabledを分ける', () => {
  const { result, rerender } = renderHook((access: ContentChangeAccess) => useContentChangeAccess(access), { initialProps: { canChangeNow: () => true, lockedReason: '閲覧のみ' } as ContentChangeAccess })
  expect(result.current.blocked).toBe(true); expect(result.current.disabled).toBe(false); expect(result.current.lockedReason).toBe('閲覧のみ'); expect(result.current.canChangeNow()).toBe(false)
  rerender({ canChangeNow: () => false }); expect(result.current.blocked).toBe(true); expect(result.current.disabled).toBe(true); expect(result.current.lockedReason).toBeUndefined(); expect(result.current.canChangeNow()).toBe(false)
  rerender({ disabled: true, canChangeNow: () => true }); expect(result.current.disabled).toBe(true); expect(result.current.canChangeNow()).toBe(false)
})
it('描画ごとに違うcallbackを操作時に読み、古い許可と古い拒否の両方を復活させない', () => {
  const { result, rerender } = renderHook((access: ContentChangeAccess) => useContentChangeAccess(access), { initialProps: { canChangeNow: () => true } as ContentChangeAccess })
  const oldYes = result.current.canChangeNow
  rerender({ canChangeNow: () => false }); const oldNo = result.current.canChangeNow
  expect(oldYes()).toBe(false); expect(oldNo()).toBe(false)
  rerender({ canChangeNow: () => true }); expect(oldNo()).toBe(false); expect(result.current.canChangeNow()).toBe(true)
})
it('描画を挟まないcallbackの失効も、操作する瞬間に拾う', () => {
  let allowed = true
  const { result } = renderHook(() => useContentChangeAccess({ canChangeNow: () => allowed }))
  const held = result.current.canChangeNow; expect(held()).toBe(true)
  allowed = false; expect(held()).toBe(false)
})
it('callbackのないdisabledや理由だけの切替も、保持した処理の前後で確認する', () => {
  const { result, rerender } = renderHook((access: ContentChangeAccess) => useContentChangeAccess(access), { initialProps: { disabled: false } as ContentChangeAccess })
  const oldYes = result.current.canChangeNow
  rerender({ disabled: true }); const oldNo = result.current.canChangeNow
  expect(oldYes()).toBe(false)
  rerender({ disabled: false }); expect(oldNo()).toBe(false); expect(result.current.canChangeNow()).toBe(true)
  const beforeReason = result.current.canChangeNow; rerender({ lockedReason: '閲覧のみ' }); expect(beforeReason()).toBe(false)
})
