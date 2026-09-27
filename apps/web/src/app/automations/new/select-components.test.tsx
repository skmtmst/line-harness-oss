// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * R21・R22 の描画の試験。主な状態（空・読み込み中・失敗・正常）を
 * 本物のReactで確かめる。直しを戻すと赤くなる。
 */
vi.mock('@/lib/api', () => ({
  api: { friends: { list: vi.fn(), get: vi.fn() } },
}))

import { api } from '@/lib/api'
import { WeekdaySelect } from './weekday-select'
import { FriendMultiSelect } from './friend-multi-select'

const mockList = api.friends.list as unknown as ReturnType<typeof vi.fn>

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  mockList.mockReset()
})

afterEach(async () => {
  if (root) await act(async () => { root!.unmount() })
  if (container) container.remove()
  root = null
  container = null
  document.body.innerHTML = ''
})

async function mount(node: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root!.render(node) })
  return container
}

async function typeText(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

function chips(el: HTMLElement): HTMLButtonElement[] {
  return Array.from(el.querySelectorAll('[role="group"] button'))
}

describe('動かす曜日の札（R21）', () => {
  it('7つの札を出し、選んだ曜日の確かめを人の言葉で出す', async () => {
    const onChange = vi.fn()
    const el = await mount(<WeekdaySelect value={[1, 3]} time="09:00" onChange={onChange} />)
    expect(chips(el).map((button) => button.textContent)).toEqual(['月', '火', '水', '木', '金', '土', '日'])
    const pressed = chips(el).filter((button) => button.getAttribute('aria-pressed') === 'true')
    expect(pressed.map((button) => button.textContent)).toEqual(['月', '水'])
    expect(el.textContent).toContain('毎週 月・水 の 09:00（日本時間）に動きます。')
    expect(el.textContent).toContain('次は ')
  })

  it('札を押すと増減し、空になると選ぶよう促す', async () => {
    let value: number[] = [1]
    const onChange = vi.fn((days: number[]) => { value = days })
    const render = async () => {
      if (root) await act(async () => { root!.render(<WeekdaySelect value={value} time="09:00" onChange={onChange} />) })
    }
    const el = await mount(<WeekdaySelect value={value} time="09:00" onChange={onChange} />)
    await click(chips(el)[1])
    expect(onChange).toHaveBeenLastCalledWith([1, 2])
    await render()
    value = []
    await render()
    expect(el.textContent).toContain('曜日を1つ以上選んでください。')
  })
})

describe('対象の友だちの複数選択（R22）', () => {
  it('選んだ人は札と人数の見出しに出し、×で外せる', async () => {
    const onChange = vi.fn()
    const el = await mount(
      <FriendMultiSelect accountId="account-1" selectedIds={['a', 'b']} names={{ a: '山田 花子', b: '佐藤 美咲' }} onChange={onChange} />,
    )
    expect(el.textContent).toContain('対象の友だち（2人）')
    expect(el.textContent).toContain('山田 花子')
    const remove = el.querySelector('button[aria-label="山田 花子を外す"]')
    if (!remove) throw new Error('外すボタンが見つかりません')
    await click(remove)
    expect(onChange).toHaveBeenCalledWith(['b'], { a: '山田 花子', b: '佐藤 美咲' })
  })

  it('名前で探して候補から足せる（読み込み中・正常）', async () => {
    const onChange = vi.fn()
    let resolveList!: (value: { success: true; data: { items: Array<{ id: string; displayName: string }> } }) => void
    mockList.mockImplementationOnce(
      () => new Promise((resolve) => { resolveList = resolve }),
    )
    const el = await mount(
      <FriendMultiSelect accountId="account-1" selectedIds={[]} names={{}} onChange={onChange} />,
    )
    const input = el.querySelector('input[aria-label="友だちを名前で探す"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('検索欄が見つかりません')
    await typeText(input, 'やま')
    // 250ms の待ちの間は読み込み中。
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)) })
    // まだ返事が無いので読み込み中のまま。
    expect(el.textContent).toContain('探しています…')
    await act(async () => {
      resolveList({ success: true, data: { items: [{ id: 'friend-1', displayName: '山田 花子' }] } })
    })
    expect(el.textContent).toContain('山田 花子')
    const add = Array.from(el.querySelectorAll('button')).find((button) => button.textContent === '追加')
    if (!add) throw new Error('追加ボタンが見つかりません')
    await click(add)
    expect(onChange).toHaveBeenCalledWith(['friend-1'], { 'friend-1': '山田 花子' })
    expect(mockList).toHaveBeenCalledWith({ accountId: 'account-1', search: 'やま', limit: 20 })
  })

  it('探せないときは失敗だけを出し、候補は出さない', async () => {
    const onChange = vi.fn()
    mockList.mockRejectedValueOnce(new Error('network'))
    const el = await mount(
      <FriendMultiSelect accountId="account-1" selectedIds={[]} names={{}} onChange={onChange} />,
    )
    const input = el.querySelector('input[aria-label="友だちを名前で探す"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('検索欄が見つかりません')
    await typeText(input, 'やま')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)) })
    expect(el.textContent).toContain('探せませんでした')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('アカウントが無ければ探せない', async () => {
    const el = await mount(
      <FriendMultiSelect accountId={null} selectedIds={[]} names={{}} onChange={vi.fn()} />,
    )
    const input = el.querySelector('input[aria-label="友だちを名前で探す"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('検索欄が見つかりません')
    expect(input.disabled).toBe(true)
    expect(mockList).not.toHaveBeenCalled()
  })
})
