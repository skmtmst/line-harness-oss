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
const saved = vi.hoisted(() => vi.fn())
const conflictNotice = vi.hoisted(() => vi.fn())

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

function Support({ id, account = 'account-a' }: { id: string; account?: string }) {
  const editor = useSupportEditor(id, saved, conflictNotice, account)
  return <><button type="button" onClick={() => void editor.openEditor()}>開く</button>{editor.dialog}</>
}

function Picker({ id, account = 'account-a' }: { id: string; account?: string }) {
  const picker = useScenarioPicker(id, id, account, saved)
  return <><button type="button" onClick={() => void picker.openPicker()}>選ぶ</button>{picker.dialog}</>
}

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}
const button = (name: string) => [...document.querySelectorAll('button')].find((el) => el.textContent?.trim() === name) as HTMLButtonElement | undefined
const chat = (friendId: string, status: string, revision: number) => ({ success: true, data: { id: `chat-${friendId}`, friendId, status, operatorId: null, revision } })

beforeEach(() => {
  saved.mockReset()
  conflictNotice.mockReset()
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

it('WEB-125: 同じ友だちIDでもアカウントを切り替えると古い窓を閉じる', async () => {
    chatGet.mockResolvedValue(chat('friend-a', 'in_progress', 3))
    await act(async () => root.render(<Support id="friend-a" />))
    await act(async () => { button('開く')!.click() }); await settle()
    await act(async () => root.render(<Support id="friend-a" account="account-b" />)); await settle()
    expect(document.querySelector('[data-support-editor]')).toBeNull()
    expect(chatUpdate).not.toHaveBeenCalled()
  })
it('WEB-125: 保存中にアカウントを切り替えると旧成功の通知を捨てる', async () => {
    chatGet.mockResolvedValue(chat('friend-a', 'in_progress', 3))
    let release!: (value: unknown) => void
    chatUpdate.mockReturnValue(new Promise((resolve) => { release = resolve }))
    await act(async () => root.render(<Support id="friend-a" />))
    await act(async () => { button('開く')!.click() }); await settle()
    await act(async () => { button('保存する')!.click() })
    await act(async () => root.render(<Support id="friend-a" account="account-b" />)); await settle()
    await act(async () => release({ success: true, data: {} })); await settle()
    expect(saved).not.toHaveBeenCalled()
    expect(document.querySelector('[data-support-editor]')).toBeNull()
  })
it('WEB-125: 同じ人の競合では窓の入力を残して改訂値だけ読み直せる', async () => {
  const { ApiError } = await import('@/lib/api')
  chatGet.mockResolvedValueOnce(chat('friend-a', 'on_hold', 3)).mockResolvedValue(chat('friend-a', 'resolved', 4))
  chatUpdate.mockRejectedValueOnce(new ApiError(409, 'conflict')).mockResolvedValue({ success: true, data: {} })
  await act(async () => root.render(<Support id="friend-a" />))
  await act(async () => { button('開く')!.click() }); await settle()
  await act(async () => { button('保存する')!.click() }); await settle()
  expect(document.querySelector('[data-support-editor]')).not.toBeNull()
  await act(async () => { button('保存する')!.click() }); await settle()
  expect(chatUpdate).toHaveBeenLastCalledWith('friend-a', { status: 'on_hold', operatorId: null, revision: 4 })
})

it.each(['success', 'failure', 'throw'])('WEB-125: Aの保存の%sでBの窓・読込待ちを変えない', async (outcome) => {
  let resolveSave!: (value: unknown) => void
  let rejectSave!: (reason: unknown) => void
  let resolveB!: (value: unknown) => void
  chatGet.mockImplementation((id: string) => id === 'friend-a'
    ? Promise.resolve(chat(id, 'on_hold', 3))
    : new Promise((resolve) => { resolveB = resolve }))
  chatUpdate.mockReturnValueOnce(new Promise((resolve, reject) => { resolveSave = resolve; rejectSave = reject }))
  await act(async () => root.render(<Support id="friend-a" />))
  await act(async () => button('開く')!.click()); await settle()
  await act(async () => button('保存する')!.click())
  await act(async () => root.render(<Support id="friend-b" />))
  await act(async () => button('開く')!.click()); await settle()
  await act(async () => {
    if (outcome === 'throw') rejectSave(new Error('Aの保存失敗'))
    else resolveSave(outcome === 'success' ? { success: true, data: {} } : { success: false, error: 'Aの保存失敗' })
  }); await settle()
  expect(document.querySelector('[data-support-editor]')).not.toBeNull()
  expect(button('処理中…')!.disabled).toBe(true)
  expect(document.body.textContent).not.toContain('Aの保存失敗')
  expect(saved).not.toHaveBeenCalled()
  await act(async () => resolveB(chat('friend-b', 'in_progress', 8))); await settle()
  expect(button('保存する')!.disabled).toBe(false)
  await act(async () => button('保存する')!.click()); await settle()
  expect(chatUpdate).toHaveBeenLastCalledWith('friend-b', { status: 'in_progress', operatorId: null, revision: 8 })
})

it('WEB-125: シナリオの窓も同じIDのアカウント切り替えで捨てる', async () => {
  scenarioList.mockResolvedValue({ success: true, data: [{ id: 'sc-1', name: 'フォロー', isActive: true }] })
  await act(async () => root.render(<Picker id="friend-a" />))
  await act(async () => button('選ぶ')!.click()); await settle()
  expect(document.querySelector('[data-scenario-picker]')).not.toBeNull()
  await act(async () => root.render(<Picker id="friend-a" account="account-b" />)); await settle()
  expect(document.querySelector('[data-scenario-picker]')).toBeNull()
  expect(scenarioEnroll).not.toHaveBeenCalled()
 })
