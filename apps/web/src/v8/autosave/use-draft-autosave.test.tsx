// @vitest-environment happy-dom
/*
 * 下書きの自動保存（★V8 共通）の試験。一斉配信と同じ動きか：
 * 止まって2秒で1回だけ保存・打ち続ける間は送らない・保存中の追記を追って送る・
 * 失敗は帯に出し同じ入力で繰り返さない・離れる確認中と閲覧のみは送らない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTOSAVE_WORDS, autosaveLabel, savedAgoLabel, useDraftAutosave } from './use-draft-autosave'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Props = { text: string; saved: string; active?: boolean; enabled?: boolean; paused?: boolean; save: () => Promise<boolean> }

let label: string | null = null
let markSaved: () => void = () => {}
function Harness({ text, saved, active = true, enabled = true, paused = false, save }: Props) {
  const autosave = useDraftAutosave({ fingerprint: text, dirty: text !== saved, active, enabled, paused, save })
  label = autosave.label
  markSaved = autosave.markSaved
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

beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  label = null
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

describe('下書きの自動保存', () => {
  it('入力が止まって2秒で1回だけ保存し、帯に「下書き保存済み・0秒前」を出す', async () => {
    const save = vi.fn(async () => true)
    await render({ text: 'a', saved: '', save })
    expect(label).toBe(AUTOSAVE_WORDS.unsaved)
    await advance(1900)
    expect(save).not.toHaveBeenCalled()
    await advance(200)
    expect(save).toHaveBeenCalledTimes(1)
    // 画面が「保存済みの形」を入れ替えると dirty が外れる。
    await render({ text: 'a', saved: 'a', save })
    expect(label).toBe('下書き保存済み・0秒前')
    await advance(10_000)
    expect(label).toBe('下書き保存済み・10秒前')
    await advance(10_000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('打ち続けている間は送らない（最後の入力から数え直す）', async () => {
    const save = vi.fn(async () => true)
    await render({ text: 'a', saved: '', save })
    await advance(1500)
    await render({ text: 'ab', saved: '', save })
    await advance(1500)
    expect(save).not.toHaveBeenCalled()
    await advance(600)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('保存中に打ち足した入力は、終わってから追って送る', async () => {
    let finish: (ok: boolean) => void = () => {}
    const save = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve }))
    await render({ text: 'a', saved: '', save })
    await advance(2100)
    expect(save).toHaveBeenCalledTimes(1)
    expect(label).toBe(AUTOSAVE_WORDS.saving)
    await render({ text: 'ab', saved: '', save })
    await act(async () => { finish(true) })
    // 'a' が保存できたが、いまは 'ab'。
    await render({ text: 'ab', saved: 'a', save })
    await advance(2100)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('失敗したら帯に出し、同じ入力では繰り返さない。打ち直せばまた送る', async () => {
    const save = vi.fn(async () => false)
    await render({ text: 'a', saved: '', save })
    await advance(2100)
    expect(save).toHaveBeenCalledTimes(1)
    expect(label).toBe(AUTOSAVE_WORDS.failed)
    await advance(10_000)
    expect(save).toHaveBeenCalledTimes(1)
    await render({ text: 'ab', saved: '', save })
    expect(label).toBe(AUTOSAVE_WORDS.unsaved)
    await advance(2100)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('保存が例外で落ちても失敗として帯に出す', async () => {
    const save = vi.fn(async () => { throw new Error('network') })
    await render({ text: 'a', saved: '', save })
    await advance(2100)
    expect(label).toBe(AUTOSAVE_WORDS.failed)
  })

  it('手で保存できたら markSaved で「保存済み」にし、失敗の印を外す', async () => {
    const save = vi.fn(async () => false)
    await render({ text: 'a', saved: '', save })
    await advance(2100)
    expect(label).toBe(AUTOSAVE_WORDS.failed)
    await act(async () => { markSaved() })
    await render({ text: 'a', saved: 'a', save })
    expect(label).toBe('下書き保存済み・0秒前')
  })

  it('離れる確認・手の保存の最中（paused）は送らない', async () => {
    const save = vi.fn(async () => true)
    await render({ text: 'a', saved: '', paused: true, save })
    await advance(5000)
    expect(save).not.toHaveBeenCalled()
    await render({ text: 'a', saved: '', paused: false, save })
    await advance(2100)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('通せない形（enabled=false）は送らず、帯は「まだ保存していません」のまま', async () => {
    const save = vi.fn(async () => true)
    await render({ text: 'a', saved: '', enabled: false, save })
    await advance(5000)
    expect(save).not.toHaveBeenCalled()
    expect(label).toBe(AUTOSAVE_WORDS.unsaved)
  })

  it('閲覧のみ（active=false）は送らず、帯にも出さない', async () => {
    const save = vi.fn(async () => true)
    await render({ text: 'a', saved: '', active: false, save })
    await advance(5000)
    expect(save).not.toHaveBeenCalled()
    expect(label).toBeNull()
  })
})

describe('帯の文', () => {
  it('一斉配信と同じ順で選ぶ', () => {
    const base = { autosaving: false, failed: false, dirty: false, savedAt: null as number | null, now: 0 }
    expect(autosaveLabel(base)).toBeNull()
    expect(autosaveLabel({ ...base, autosaving: true, dirty: true })).toBe('下書きを保存しています…')
    expect(autosaveLabel({ ...base, dirty: true })).toBe('下書きはまだ保存していません')
    expect(autosaveLabel({ ...base, savedAt: 0, now: 42_000 })).toBe('下書き保存済み・42秒前')
  })
  it('1分を過ぎたら「n分前」', () => {
    expect(savedAgoLabel(0, 59_000)).toBe('59秒前')
    expect(savedAgoLabel(0, 3 * 60_000)).toBe('3分前')
  })
})
