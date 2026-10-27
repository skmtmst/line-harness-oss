// @vitest-environment happy-dom
/*
 * 開始条件の窓（EvVO5）で、きっかけの6種と「現在の条件に一致する友だち」を描いて確かめる。
 * - 6種を並べ、口の無い4種は押せない形（まだ使えません）にして理由を書く
 * - 押す前に一致人数を試算の口から出す。予約中は引き算で作らず、試算の値をそのまま出す
 * - 読込中・取得失敗の言葉を分け、失敗は再読み込みで取り直せる。取れない値に単位を付けない
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TriggerEditor from './trigger-editor'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const listTriggers = vi.hoisted(() => vi.fn())
const simulate = vi.hoisted(() => vi.fn())
const fetchTags = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/api')>()),
  api: {
    tags: { list: fetchTags },
    tagGroups: { list: vi.fn(async () => ({ success: true, data: [] })) },
    scenarios: {
      triggers: { list: listTriggers, add: vi.fn(), remove: vi.fn() },
      simulate,
    },
  },
}))

vi.mock('@/components/scenarios/scenario-reference-data', () => ({
  scenarioReferenceData: { tags: fetchTags },
}))

const AUDIENCE = { matched: 10, alreadySubscribed: 2, newStartPlanned: 5, excluded: 3 }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

async function renderEditor(props: Partial<Parameters<typeof TriggerEditor>[0]> = {}) {
  render(<TriggerEditor scenarioId="sc-1" onClose={vi.fn()} onChanged={vi.fn()} lineAccountId="acc-1" {...props} />)
  await screen.findByText('友だち追加時')
  await act(async () => {})
}

/** 「一致」「すでに購読中」「予約中」の見出しの隣の値。 */
function valueOf(label: string): string {
  const term = screen.getAllByText(label).find((el) => el.tagName === 'DT')!
  return term.nextElementSibling?.textContent ?? ''
}

beforeEach(() => {
  listTriggers.mockResolvedValue({ success: true, data: [{ id: 'trig-1', kind: 'friend_add', tagId: null }] })
  simulate.mockResolvedValue({ success: true, data: { audience: AUDIENCE, steps: [] } })
  fetchTags.mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EvVO5 開始のきっかけの6種', () => {
  it('6種を並べ、口の無い4種だけ押せない形にして、理由を書く', async () => {
    await renderEditor()
    const kinds = ['友だち追加', 'タグ追加', 'フォーム回答', '予約確定', '手動開始', 'API・Webhook']
    const notReady = new Set(['フォーム回答', '予約確定', '手動開始', 'API・Webhook'])
    for (const label of kinds) {
      const tile = screen.getAllByText(label, { exact: true }).map((el) => el.parentElement!).find((el) => el.hasAttribute('aria-disabled') || el.textContent?.match(/設定済み|足せます/))!
      expect(tile, label).toBeTruthy()
      expect(tile.getAttribute('aria-disabled') === 'true', label).toBe(notReady.has(label))
      expect(tile.textContent, label).toContain(notReady.has(label) ? 'まだ使えません' : label === '友だち追加' ? '設定済み' : '足せます')
    }
    expect(screen.getAllByText('まだ使えません')).toHaveLength(4)
    expect(screen.getByText('フォーム回答・予約確定・手動開始・API・Webhook をきっかけにする口は、まだ繋がっていません。繋がると、ここから足せるようになります。')).toBeTruthy()
  })
})

describe('EvVO5 押す前に一致人数を出す', () => {
  it('試算の口を所属アカウントで呼び、一致・すでに購読中・予約中を試算の値のまま出す', async () => {
    await renderEditor()
    expect(simulate).toHaveBeenCalledWith('sc-1', 'acc-1')
    expect(valueOf('一致')).toBe('10人')
    expect(valueOf('すでに購読中')).toBe('2人')
    // 予約中は一致−購読中（8）で作らず、試算の newStartPlanned をそのまま出す。
    expect(valueOf('予約中')).toBe('5人')
    expect(screen.getByText(/対象外は3人です。試算では配信も購読も始まりません。/)).toBeTruthy()
  })

  it('対象を再計算で試算を取り直す', async () => {
    await renderEditor()
    simulate.mockResolvedValue({ success: true, data: { audience: { ...AUDIENCE, matched: 12 }, steps: [] } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '対象を再計算' })) })
    expect(simulate).toHaveBeenCalledTimes(2)
    expect(valueOf('一致')).toBe('12人')
  })

  it('読込中は「読み込んでいます」、失敗は「読み込めませんでした」で、取れない値に単位を付けない。再読み込みで取り直す', async () => {
    const slow = deferred<unknown>()
    simulate.mockReturnValueOnce(slow.promise)
    await renderEditor()
    expect(valueOf('一致')).toBe('読み込んでいます')
    expect(valueOf('予約中')).toBe('—')
    await act(async () => { slow.resolve({ success: false, error: 'offline' }) })
    expect(valueOf('一致')).toBe('読み込めませんでした')
    expect(valueOf('予約中')).toBe('—')
    expect(document.body.textContent).not.toContain('—人')
    expect(document.body.textContent).not.toContain('読み込み中…')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '再読み込み' })) })
    expect(simulate).toHaveBeenCalledTimes(2)
    expect(valueOf('一致')).toBe('10人')
  })
})
