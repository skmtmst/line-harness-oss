// @vitest-environment happy-dom
/*
 * 同じ画面の中のクエリだけの書き換えは、ルーターを通さず履歴だけを書き換える
 * （2026-10-08 オーナー：統括の一括配信を作るで「次へ」を押すと「このサイトを離れますか？」）。
 *
 * ルーターを通すと Next は RSC（`<path>.txt`）を取りに行き、新しい版が出た後は版IDの
 * 違いで画面を丸ごと読み直す。別の住所へ行くときだけルーターを使う。
 */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const replace = vi.hoisted(() => vi.fn())
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push }) }))

import { isSamePagePath, useSamePageUrl, type SamePageUrl } from './use-same-page-url'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let api: SamePageUrl | null = null
function Probe() { api = useSamePageUrl(); return null }

describe('useSamePageUrl', () => {
  let host: HTMLDivElement
  beforeEach(async () => {
    window.history.replaceState(null, '', '/hq/broadcasts/new')
    host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<Probe />) })
  })
  afterEach(() => { host.remove(); vi.clearAllMocks(); api = null })

  it('同じ住所の ?step= の切り替えはルーターを通さず、履歴を積まずに書き換える', () => {
    const before = window.history.length
    api!.replace('/hq/broadcasts/new?step=audience')
    expect(window.location.pathname).toBe('/hq/broadcasts/new')
    expect(window.location.search).toBe('?step=audience')
    expect(window.history.length).toBe(before)
    expect(replace).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('「?〜」だけの書き方も同じ住所として扱う', () => {
    api!.replace('?tab=staff&page=2')
    expect(window.location.pathname).toBe('/hq/broadcasts/new')
    expect(window.location.search).toBe('?tab=staff&page=2')
    expect(replace).not.toHaveBeenCalled()
  })

  it('push は履歴を積む（戻るで前のタブへ）', () => {
    const before = window.history.length
    api!.push('/hq/broadcasts/new?tab=settings')
    expect(window.location.search).toBe('?tab=settings')
    expect(window.history.length).toBe(before + 1)
    expect(push).not.toHaveBeenCalled()
  })

  it('別の住所へはルーターで行く', () => {
    api!.replace('/hq/broadcasts/detail?id=run-1')
    expect(replace).toHaveBeenCalledWith('/hq/broadcasts/detail?id=run-1')
    expect(window.location.pathname).toBe('/hq/broadcasts/new')
    api!.push('/broadcasts')
    expect(push).toHaveBeenCalledWith('/broadcasts')
  })

  it('isSamePagePath は住所（パス）だけを比べる', () => {
    expect(isSamePagePath('/hq/broadcasts/new?step=confirm')).toBe(true)
    expect(isSamePagePath('?id=1')).toBe(true)
    expect(isSamePagePath('/hq/broadcasts')).toBe(false)
    expect(isSamePagePath('https://example.com/hq/broadcasts/new')).toBe(false)
  })
})
