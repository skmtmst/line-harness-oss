// @vitest-environment happy-dom
/*
 * 個別操作の窓（dialogs.tsx）の対象の固定（WEB125）。
 * 友だち A で開いた入力・改訂値を、同じ画面のまま ?id= が B に変わった後で B へ送らない。
 * A の遅い読込が、B で開き直した窓の値を上書きしない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const chatGet = vi.hoisted(() => vi.fn())
const chatUpdate = vi.hoisted(() => vi.fn())
const scenarioList = vi.hoisted(() => vi.fn())
const scenarioEnroll = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      chats: { ...actual.api.chats, get: chatGet, update: chatUpdate },
      scenarios: { ...actual.api.scenarios, list: scenarioList, enroll: scenarioEnroll },
    },
  }
})
vi.mock('@/lib/operators-cache', () => ({
  loadOperators: async () => ({ success: true, data: [{ id: 'op-1', name: '高田' }] }),
}))

import { useScenarioPicker, useSupportEditor } from './dialogs'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

function Support({ id }: { id: string }) {
  const editor = useSupportEditor(id, () => {}, () => {})
  return <><button type="button" onClick={() => void editor.openEditor()}>開く</button>{editor.dialog}</>
}

function Picker({ id }: { id: string }) {
  const picker = useScenarioPicker(id, id, 'account-a', () => {})
  return <><button type="button" onClick={() => void picker.openPicker()}>選ぶ</button>{picker.dialog}</>
}

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}
const button = (name: string) => [...document.querySelectorAll('button')].find((el) => el.textContent?.trim() === name) as HTMLButtonElement | undefined
const chat = (friendId: string, status: string, revision: number) => ({ success: true, data: { id: `chat-${friendId}`, friendId, status, operatorId: null, revision } })

beforeEach(() => {
  chatGet.mockReset()
  chatUpdate.mockReset()
  scenarioList.mockReset()
  scenarioEnroll.mockReset()
  chatUpdate.mockResolvedValue({ success: true, data: {} })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

describe('対応状況の窓は開いた友だちに固定する（WEB125）', () => {
  it('A で開いたまま B に変わると窓を閉じ、A の入力を B へ保存できない', async () => {
    chatGet.mockImplementation(async (id: string) => chat(id, 'in_progress', 3))
    await act(async () => root.render(<Support id="friend-a" />))
    await act(async () => { button('開く')!.click() })
    await settle()
    expect(document.querySelector('[data-support-editor]')).not.toBeNull()

    await act(async () => root.render(<Support id="friend-b" />))
    await settle()
    expect(document.querySelector('[data-support-editor]')).toBeNull()
    expect(button('保存する')).toBeUndefined()
    expect(chatUpdate).not.toHaveBeenCalled()
  })

  it('A の遅い読込は、B で開き直した窓の値（改訂値）を上書きしない', async () => {
    let releaseA: (value: unknown) => void = () => {}
    chatGet.mockImplementation((id: string) => id === 'friend-a'
      ? new Promise((resolve) => { releaseA = resolve })
      : Promise.resolve(chat(id, 'on_hold', 9)))
    await act(async () => root.render(<Support id="friend-a" />))
    await act(async () => { button('開く')!.click() })
    await act(async () => root.render(<Support id="friend-b" />))
    await settle()
    await act(async () => { button('開く')!.click() })
    await settle()
    await act(async () => { releaseA(chat('friend-a', 'resolved', 3)) })
    await settle()

    await act(async () => { button('保存する')!.click() })
    await settle()
    expect(chatUpdate).toHaveBeenCalledTimes(1)
    expect(chatUpdate).toHaveBeenCalledWith('friend-b', { status: 'on_hold', operatorId: null, revision: 9 })
  })
})

describe('シナリオの窓も開いた友だちに固定する（WEB125）', () => {
  it('A で開いたまま B に変わると窓を閉じ、B へ登録しない', async () => {
    scenarioList.mockResolvedValue({ success: true, data: [{ id: 'sc-1', name: '7日間フォロー', isActive: true }] })
    await act(async () => root.render(<Picker id="friend-a" />))
    await act(async () => { button('選ぶ')!.click() })
    await settle()
    expect(document.querySelector('[data-scenario-picker]')).not.toBeNull()

    await act(async () => root.render(<Picker id="friend-b" />))
    await settle()
    expect(document.querySelector('[data-scenario-picker]')).toBeNull()
    expect(scenarioEnroll).not.toHaveBeenCalled()
  })
})
