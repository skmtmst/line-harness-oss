// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * O-1 公開の前の確認セクションの描画試験。
 * 4つの確認（自前・LINE・実機・ページ数）と、2つのボタン（検査・実機で見た）を確かめる。
 * 差し替えるのは通信(api)だけ。
 */

const net = vi.hoisted(() => ({
  checkResult: undefined as unknown,
  validateResult: undefined as unknown,
  confirmResult: undefined as unknown,
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      richMenuGroups: {
        ...actual.api.richMenuGroups,
        prepublishCheck: async () => net.checkResult,
        validatePublish: async () => net.validateResult,
        confirmDevice: async () => net.confirmResult,
      },
    },
  }
})

const { PrepublishCheckSection } = await import('./prepublish-check-section')

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function unchecked() {
  return {
    success: true,
    data: {
      fingerprint: 'fp-1',
      pageCount: 1,
      maxPages: 10,
      selfCheck: { ok: true, message: '自前の検査を通りました。' },
      deviceConfirmed: false,
      deviceConfirmedAt: null,
      versionNumber: null,
    },
  }
}

function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === label)
  expect(button).toBeTruthy()
  return act(async () => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

beforeEach(async () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  net.validateResult = {
    success: true,
    data: { checks: [{ key: 'line', ok: true, message: 'LINEの検査を通りました。' }] },
  }
  net.confirmResult = { success: true, data: { confirmedAt: '2026-09-27T00:00:00', fingerprint: 'fp-1' } }
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
})

describe('公開の前の確認', () => {
  it('4つの確認と2つのボタンを出す', async () => {
    net.checkResult = unchecked()
    await act(async () => {
      root.render(<PrepublishCheckSection groupId="g1" />)
    })
    await flush()

    const text = container.textContent ?? ''
    expect(text).toContain('自前の検査')
    expect(text).toContain('LINEの検査')
    expect(text).toContain('実機で見た')
    expect(text).toContain('ページ数')
    expect(text).toContain('LINEの検査を通す')
  })

  it('実機で見たを押すと確認済みになる', async () => {
    net.checkResult = unchecked()
    await act(async () => {
      root.render(<PrepublishCheckSection groupId="g1" />)
    })
    await flush()
    expect(container.textContent).toContain('まだ確認がありません')

    await click('実機で見た')
    await flush()
    expect(container.textContent).toContain('スマートフォンの実機で確認済みです。')
  })

  it('LINEの検査を通すと結果が出る', async () => {
    net.checkResult = unchecked()
    await act(async () => {
      root.render(<PrepublishCheckSection groupId="g1" />)
    })
    await flush()

    await click('LINEの検査を通す')
    await flush()
    expect(container.textContent).toContain('LINEの検査を通りました。')
  })

  it('読めないときは読み込めなかったとだけ出す', async () => {
    net.checkResult = Promise.reject(new Error('down'))
    await act(async () => {
      root.render(<PrepublishCheckSection groupId="g1" />)
    })
    await flush()
    expect(container.textContent).toContain('確認の状態を読み込めませんでした。')
  })
})
