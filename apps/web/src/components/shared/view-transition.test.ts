// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withViewTransition } from './view-transition'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * ブラウザと同じ順で callback を呼ぶ偽の startViewTransition。
 * 古い画面を撮ったあと（後のコマ）に callback を呼び、その戻り値を待ち終えた時点の
 * 画面を「新しい絵」として記録する。
 */
function fakeStarter(readScreen: () => string) {
  const shots: { before: string; after: string }[] = []
  const starter = vi.fn((callback: () => unknown) => {
    const before = readScreen()
    const updateCallbackDone = Promise.resolve()
      .then(() => callback())
      .then(() => { shots.push({ before, after: readScreen() }) })
    return { updateCallbackDone, finished: updateCallbackDone, ready: updateCallbackDone }
  })
  ;(document as Document & { startViewTransition?: unknown }).startViewTransition = starter
  return { starter, shots }
}

afterEach(() => {
  vi.unstubAllGlobals()
  const doc = document as Document & { startViewTransition?: unknown }
  delete doc.startViewTransition
})

describe('withViewTransition（つながる移り変わり・D）', () => {
  it('startViewTransition が無ければ、そのまま変える', () => {
    const update = vi.fn()
    withViewTransition(update)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('あるときは startViewTransition の中で変える', () => {
    const update = vi.fn()
    const starter = vi.fn((callback: () => void) => {
      callback()
      return undefined
    })
    ;(document as Document & { startViewTransition?: unknown }).startViewTransition = starter
    withViewTransition(update)
    expect(starter).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('動きを減らす設定では素通りする', () => {
    const update = vi.fn()
    const starter = vi.fn((callback: () => void) => {
      callback()
      return undefined
    })
    ;(document as Document & { startViewTransition?: unknown }).startViewTransition = starter
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    withViewTransition(update)
    expect(starter).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('新しい絵は React の更新が DOM に反映された後で撮られる（タブの切り替え）', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    let switchTab: () => Promise<void> = async () => {}
    function Tabs() {
      const [tab, setTab] = useState('一覧')
      switchTab = () => withViewTransition(() => setTab('詳細'))
      return createElement('p', null, tab)
    }
    await act(async () => { root.render(createElement(Tabs)) })
    const { shots } = fakeStarter(() => host.textContent ?? '')
    let done: Promise<void> = Promise.resolve()
    await act(async () => {
      done = switchTab()
      await done
    })
    expect(shots).toEqual([{ before: '一覧', after: '詳細' }])
    await expect(done).resolves.toBeUndefined()
    act(() => root.unmount())
    host.remove()
  })

  it('update が Promise を返すときは、その終わり（読み込み後の反映）まで待ってから撮る', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    let resolveLoad: () => void = () => {}
    const { shots } = fakeStarter(() => host.textContent ?? '')
    host.textContent = '前のページ'
    const done = withViewTransition(async () => {
      await new Promise<void>((resolve) => { resolveLoad = resolve })
      host.textContent = '次のページ'
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(shots).toEqual([])
    resolveLoad()
    await done
    expect(shots).toEqual([{ before: '前のページ', after: '次のページ' }])
    host.remove()
  })
})
