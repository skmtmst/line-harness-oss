// @vitest-environment happy-dom
/*
 * 下書きの API が無い画面のブラウザ下書き（★V8 共通）の試験。
 * 止まって2秒で書く・開き直すと「前の入力を戻す」・戻す／捨てる・保存済みと同じなら出さない・
 * 閲覧のみは読み書きしない・localStorage が使えなくても落ちない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BROWSER_DRAFT_WORDS, browserDraftKey, readBrowserDraft, useBrowserDraft } from './use-browser-draft'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const KEY = browserDraftKey(['test', 'account-a', 'row-1'])
type Props = { storageKey?: string | null; value: string; baseline: string; active?: boolean }
let api: ReturnType<typeof useBrowserDraft<string>> | null = null
function Harness({ storageKey = KEY, value, baseline, active = true }: Props) {
  api = useBrowserDraft({ storageKey, value, baseline, active })
  return null
}

let host: HTMLDivElement
let root: Root
const render = async (props: Props) => {
  await act(async () => { root.render(<Harness {...props} />) })
}
const advance = async (ms: number) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}
const remount = async (props: Props) => {
  act(() => root.unmount())
  root = createRoot(host)
  await render(props)
}

/* 試験の環境に localStorage が無いので、ブラウザと同じ口の入れ物を置く。 */
function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, String(value)) },
    removeItem: (key: string) => { map.delete(key) },
    clear: () => map.clear(),
    get length() { return map.size },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('localStorage', memoryStorage())
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  api = null
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('ブラウザ下書き', () => {
  it('止まって2秒で書き、帯に「このブラウザに一時保存済み」を出す', async () => {
    await render({ value: '書きかけ', baseline: '' })
    expect(api?.label).toBe(BROWSER_DRAFT_WORDS.unsaved)
    await advance(1900)
    expect(readBrowserDraft(KEY)).toBeNull()
    await advance(200)
    expect(readBrowserDraft<string>(KEY)?.value).toBe('書きかけ')
    expect(api?.label).toBe('入力をこのブラウザに一時保存済み・0秒前')
  })

  it('開き直すと「前の入力を戻す」を出し、戻すと値を返す', async () => {
    await render({ value: '書きかけ', baseline: '' })
    await advance(2100)
    await remount({ value: '', baseline: '' })
    expect(api?.pendingAgo).toBe('0秒前')
    let restored: string | null = null
    await act(async () => { restored = api!.restore() })
    expect(restored).toBe('書きかけ')
    expect(api?.pendingAgo).toBeNull()
  })

  it('戻すか決める前は上書きしない（前の入力を消さない）', async () => {
    await render({ value: '前の入力', baseline: '' })
    await advance(2100)
    await remount({ value: '', baseline: '' })
    await render({ value: '別の入力', baseline: '' })
    await advance(5000)
    expect(readBrowserDraft<string>(KEY)?.value).toBe('前の入力')
  })

  it('捨てる（clear）と消え、次に開いても出ない', async () => {
    await render({ value: '書きかけ', baseline: '' })
    await advance(2100)
    await remount({ value: '', baseline: '' })
    await act(async () => { api!.clear() })
    expect(readBrowserDraft(KEY)).toBeNull()
    await remount({ value: '', baseline: '' })
    expect(api?.pendingAgo).toBeNull()
  })

  it('保存済みの形と同じものは戻す候補にしない', async () => {
    await render({ value: '保存した', baseline: '' })
    await advance(2100)
    await remount({ value: '保存した', baseline: '保存した' })
    expect(api?.pendingAgo).toBeNull()
    expect(readBrowserDraft(KEY)).toBeNull()
  })

  it('保存できて元の形にそろったら消す', async () => {
    await render({ value: '書きかけ', baseline: '' })
    await advance(2100)
    await render({ value: '書きかけ', baseline: '書きかけ' })
    expect(readBrowserDraft(KEY)).toBeNull()
    expect(api?.label).toBeNull()
  })

  it('閲覧のみ（active=false）は書かず、残っていても出さない', async () => {
    await render({ value: '書きかけ', baseline: '', active: false })
    await advance(5000)
    expect(readBrowserDraft(KEY)).toBeNull()
    expect(api?.label).toBeNull()
    window.localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), value: '前の入力' }))
    await remount({ value: '', baseline: '', active: false })
    expect(api?.pendingAgo).toBeNull()
  })

  it('localStorage が使えなくても落ちない', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => { throw new Error('QuotaExceededError') },
      removeItem: () => { throw new Error('SecurityError') },
    })
    await render({ value: '書きかけ', baseline: '' })
    await advance(2100)
    expect(api?.label).toBe(BROWSER_DRAFT_WORDS.unsaved)
    expect(api?.pendingAgo).toBeNull()
  })

  it('キーが決まるまで（読み込み前）は何もしない', async () => {
    await render({ storageKey: null, value: '書きかけ', baseline: '' })
    await advance(5000)
    expect(window.localStorage.length).toBe(0)
  })
})
