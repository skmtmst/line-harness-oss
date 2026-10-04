// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withViewTransition } from './view-transition'

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
})
