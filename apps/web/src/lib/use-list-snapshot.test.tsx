// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useListSnapshot } from './use-list-snapshot'

afterEach(cleanup)

it('同じ条件の再取得中は、取得済みの0件も一覧の値として保つ', () => {
  const view = renderHook(({ scope }) => useListSnapshot<string[]>(scope, []), { initialProps: { scope: 'a' } })
  expect(view.result.current.hasValue).toBe(false)
  act(() => view.result.current.setValue([]))
  view.rerender({ scope: 'a' })
  expect(view.result.current.hasValue).toBe(true)
  expect(view.result.current.value).toEqual([])
})

it('アカウント・条件が変わった最初の描画から旧行を隠し、古い応答も受け付けない', () => {
  const renders: string[][] = []
  const view = renderHook(({ scope }) => {
    const snapshot = useListSnapshot<string[]>(scope, [])
    renders.push(snapshot.value)
    return snapshot
  }, { initialProps: { scope: 'account-a:all' } })
  act(() => view.result.current.setValue(['前の行']))
  const staleUpdate = view.result.current.setValue
  renders.length = 0
  view.rerender({ scope: 'account-b:all' })
  expect(renders.every(rows => rows.length === 0)).toBe(true)
  act(() => staleUpdate(['遅れて返った前の行']))
  expect(view.result.current.value).toEqual([])
  expect(view.result.current.hasValue).toBe(false)
  act(() => view.result.current.setValue(['今の行']))
  expect(view.result.current.value).toEqual(['今の行'])
  view.rerender({ scope: 'account-b:filtered' })
  expect(view.result.current.value).toEqual([])
})

it('切替先の応答前に元のアカウントへ戻っても、前の取得結果と更新口を復活させない', () => {
  const view = renderHook(({ scope }) => useListSnapshot<string[]>(scope, []), { initialProps: { scope: 'A' } })
  act(() => view.result.current.setValue(['Aの以前の行']))
  const oldUpdate = view.result.current.setValue
  view.rerender({ scope: 'B' })
  view.rerender({ scope: 'A' })
  expect(view.result.current.value).toEqual([])
  expect(view.result.current.hasValue).toBe(false)
  act(() => oldUpdate(['Aの遅い応答']))
  expect(view.result.current.value).toEqual([])
  act(() => view.result.current.setValue(['今のAの行']))
  expect(view.result.current.value).toEqual(['今のAの行'])
})
