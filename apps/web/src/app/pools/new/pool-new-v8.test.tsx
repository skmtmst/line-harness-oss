// @vitest-environment happy-dom
/*
 * ★V8-B プール管理の「プールを作る」（板 `D0AOyx`）。
 * 番号つきの節・複数の受け入れ先・部分失敗の伝え方が動くこと。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lineAccountsList = vi.hoisted(() => vi.fn())
const poolsCreate = vi.hoisted(() => vi.fn())
const poolsAccountsAdd = vi.hoisted(() => vi.fn())
const routerPush = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      lineAccounts: { ...actual.api.lineAccounts, list: lineAccountsList },
      pools: {
        ...actual.api.pools,
        create: poolsCreate,
        accounts: { ...actual.api.pools.accounts, add: poolsAccountsAdd },
      },
    },
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}))

vi.mock('next/link', () => ({
  default: ({ children, ...p }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <a {...(p as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>
  ),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
}))

import PoolNewV8 from './pool-new-v8'

const v8tsx = readFileSync(join(process.cwd(), 'src/app/pools/new/pool-new-v8.tsx'), 'utf8')

const ACCOUNTS = [
  { id: 'a1', name: '然-NEN-渋谷店' },
  { id: 'a2', name: '然-NEN-中目黒店' },
]

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  lineAccountsList.mockReset()
  poolsCreate.mockReset()
  poolsAccountsAdd.mockReset()
  routerPush.mockReset()
  lineAccountsList.mockResolvedValue({ success: true, data: ACCOUNTS })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  document.body.innerHTML = ''
})

async function flush() {
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

async function renderV8() {
  await act(async () => { root.render(<PoolNewV8 />) })
  await flush()
}

async function setInput(selector: string, value: string) {
  const input = document.querySelector(selector) as HTMLInputElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await flush()
}

describe('V8-B プールを作る（D0AOyx）', () => {
  it('番号つきの節とプレビューが出る', async () => {
    await renderV8()
    expect(document.querySelector('[data-design-node="D0AOyx"]'), '板IDの枠がある').toBeTruthy()
    expect(document.querySelector('[data-create-variant="v6"]'), '作る画面の枠がある').toBeTruthy()
    expect(document.body.textContent).toContain('1. どのプールか')
    expect(document.body.textContent).toContain('2. いまの受け入れ先')
    expect(document.body.textContent).toContain('プレビュー')
  })

  async function chooseSecondAccount() {
    // 2件目を足す（共有 Select は小さな窓で選ぶ形）
    const addButton = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('アカウントを足す'))
    await act(async () => { addButton!.click() })
    await flush()
    const trigger = document.querySelector('button[aria-label="足すアカウント"]') as HTMLButtonElement
    await act(async () => { trigger!.click() })
    await flush()
    const option = [...document.querySelectorAll('[role="option"] button')].find((o) => o.textContent === '然-NEN-中目黒店') as HTMLElement
    await act(async () => { option!.click() })
    await flush()
    const add = [...document.querySelectorAll('button')].find((b) => b.textContent === '追加')
    await act(async () => { add!.click() })
    await flush()
  }

  it('複数の受け入れ先で作り、残りを1件ずつ足す', async () => {
    poolsCreate.mockResolvedValue({ success: true, data: { id: 'p1' } })
    poolsAccountsAdd.mockResolvedValue({ success: true, data: {} })
    await renderV8()
    await setInput('#pl-name', '渋谷エリア')
    await setInput('#pl-slug', 'shibuya')
    await chooseSecondAccount()
    expect(document.body.textContent).toContain('然-NEN-中目黒店')

    const save = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('保存してURLを発行'))
    expect(save, '保存の帯がある').toBeTruthy()
    await act(async () => { save!.click() })
    await flush()
    expect(poolsCreate).toHaveBeenCalledWith({ name: '渋谷エリア', slug: 'shibuya', activeAccountId: 'a1' })
    expect(poolsAccountsAdd, '2件目を1件ずつ足す').toHaveBeenCalledWith('p1', 'a2')
    expect(routerPush, '保存できたら一覧へ進む').toHaveBeenCalled()
  })

  it('2件目の追加に落ちたら名前を挙げて伝える', async () => {
    poolsCreate.mockResolvedValue({ success: true, data: { id: 'p1' } })
    poolsAccountsAdd.mockResolvedValue({ success: false, error: 'down' })
    await renderV8()
    await setInput('#pl-name', '渋谷エリア')
    await setInput('#pl-slug', 'shibuya2')
    await chooseSecondAccount()
    const save = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('保存してURLを発行'))
    await act(async () => { save!.click() })
    await flush()
    expect(document.body.textContent).toContain('然-NEN-中目黒店の追加に失敗しました')
    expect(routerPush, '落ちた分があるときは進まない').not.toHaveBeenCalled()
  })

  it('V8 の決まり（板ID・準備中なし）を守る', () => {
    expect(v8tsx).toContain('designNode="D0AOyx"')
    expect(v8tsx).not.toContain('準備中')
  })
})
