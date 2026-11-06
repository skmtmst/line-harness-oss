// @vitest-environment happy-dom
/*
 * カルーセルの呼び方と上限を、本物の画面で押して確かめる（設計 `FRkls` 11-1-B ／ 要件 11 §156・§160）。
 *
 * 設計も要件も「パネル」と呼び、上限を 10 と決めている。
 * 「もっと見る」も LINE の10列のうち1列を使うので、付けるときは本文9枚まで。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { within } from '@testing-library/react'
import BroadcastAssetManager from './broadcast-asset-manager'
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', loading: false }),
}))

const { list, create } = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<Record<string, unknown>>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...(actual.api as Record<string, unknown>),
      broadcastMessageAssets: {
        list,
        create,
        update: vi.fn(),
        delete: async () => ({ success: true }),
        upload: vi.fn(),
      },
    },
  }
})

;Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let container: HTMLDivElement
let root: Root

function buttons(): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')]
}

function buttonStarting(label: string): HTMLButtonElement {
  const el = buttons().find((b) => b.textContent?.startsWith(label))
  if (!el) throw new Error(`button not found: ${label}`)
  return el
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function openNewCarousel() {
  act(() => {
    root.render(<BroadcastAssetManager kind="card_message" />)
  })
  await act(async () => {
    await Promise.resolve()
  })
  click(buttonStarting('カルーセルを作る'))
}

function addPanelButton(): HTMLButtonElement {
  return buttonStarting('＋ パネルを追加する')
}

function moreCardSwitch(): HTMLButtonElement {
  return within(container).getByRole<HTMLButtonElement>('switch', { name: '末尾に「もっと見る」パネルを表示' })
}

beforeEach(() => {
  vi.clearAllMocks()
  list.mockResolvedValue({ success: true, data: [] })
  create.mockResolvedValue({ success: true, data: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe('カルーセルの呼び方', () => {
  it('種類を「カルーセル」、1枚ずつを「パネル」と呼ぶ', async () => {
    await openNewCarousel()
    expect(container.textContent).toContain('新しいカルーセル')
    expect(container.textContent).toContain('パネル 1')
    expect(addPanelButton().textContent).toBe('＋ パネルを追加する（1/10）')
    expect(container.textContent).toContain('末尾に「もっと見る」パネルを表示')
    expect(container.textContent).not.toMatch(/カードを追加|カードを表示/)
  })
})

describe('パネルの上限', () => {
  it('「もっと見る」を外すと 10 枚まで作れ、10 枚で追加を止める', async () => {
    await openNewCarousel()
    click(moreCardSwitch())
    expect(moreCardSwitch().getAttribute('aria-checked')).toBe('false')
    for (let count = 1; count < 10; count += 1) click(addPanelButton())
    expect(container.textContent).toContain('パネル 10')
    expect(addPanelButton().textContent).toBe('＋ パネルを追加する（10/10）')
    expect(addPanelButton().disabled).toBe(true)
  })

  it('「もっと見る」を付けると、その1列ぶん本文は 9 枚までになり、理由を出す', async () => {
    await openNewCarousel()
    expect(moreCardSwitch().getAttribute('aria-checked')).toBe('true')
    expect(container.textContent).toContain('「もっと見る」で1枠使うため、パネルは9枚までです。')
    for (let count = 1; count < 9; count += 1) click(addPanelButton())
    expect(addPanelButton().textContent).toBe('＋ パネルを追加する（9/10）')
    expect(addPanelButton().disabled).toBe(true)

    // 外すと 10 枚目を足せるようになり、理由も消える。
    click(moreCardSwitch())
    expect(addPanelButton().disabled).toBe(false)
    expect(container.textContent).not.toContain('1枠使うため')
  })
})
