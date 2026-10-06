// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prefetch = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch }),
}))

import HoverPrefetch from './hover-prefetch'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  document.documentElement.dataset.theme = 'v8'
})

beforeEach(() => {
  vi.useFakeTimers()
  prefetch.mockClear()
  document.documentElement.dataset.theme = 'v8'
})

afterEach(() => {
  vi.useRealTimers()
})

function hover(anchor: HTMLAnchorElement) {
  fireEvent.mouseOver(anchor)
  act(() => {
    vi.advanceTimersByTime(150)
  })
}

describe('HoverPrefetch（リンクの先読み・F①）', () => {
  it('同じタブ内の行き先を少し置いてから先に読む', () => {
    render(
      <>
        <HoverPrefetch />
        <a href="/broadcasts">一斉配信</a>
      </>,
    )
    hover(document.querySelector('a')!)
    expect(prefetch).toHaveBeenCalledWith('/broadcasts')
  })

  it('すぐ離したら読まない', () => {
    render(
      <>
        <HoverPrefetch />
        <a href="/broadcasts">一斉配信</a>
      </>,
    )
    const anchor = document.querySelector('a')!
    fireEvent.mouseOver(anchor)
    fireEvent.mouseOut(anchor)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(prefetch).not.toHaveBeenCalled()
  })

  it('外の行き先は読まない', () => {
    render(
      <>
        <HoverPrefetch />
        <a href="https://example.com/help">助け</a>
      </>,
    )
    hover(document.querySelector('a')!)
    expect(prefetch).not.toHaveBeenCalled()
  })

  it('v7 では読まない', () => {
    document.documentElement.dataset.theme = 'v7'
    render(
      <>
        <HoverPrefetch />
        <a href="/broadcasts">一斉配信</a>
      </>,
    )
    hover(document.querySelector('a')!)
    expect(prefetch).not.toHaveBeenCalled()
  })

  it('data-prefetch の API も温める', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    try {
      render(
        <>
          <HoverPrefetch />
          <a href="/broadcasts" data-prefetch="/api/broadcasts/summary">
            一斉配信
          </a>
        </>,
      )
      hover(document.querySelector('a')!)
      expect(prefetch).toHaveBeenCalledWith('/broadcasts')
      expect(spy).toHaveBeenCalledWith('/api/broadcasts/summary', expect.objectContaining({ credentials: 'same-origin' }))
    } finally {
      spy.mockRestore()
    }
  })
})
