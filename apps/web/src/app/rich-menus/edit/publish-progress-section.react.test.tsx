// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import RichMenuDetailV8 from '@/v8/rich-menu-edit/detail'

/**
 * K-1 公開の進みセクションの描画試験。
 * 主な状態（読み込み中・失敗・空・正常）と、失敗時の「もう一度公開する」を確かめる。
 * 差し替えるのは通信(api)だけ。
 */

const net = vi.hoisted(() => ({
  progressResult: undefined as unknown,
  publish: vi.fn(),
}))

vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: async () => ({ success: true, data: { id: 'owner-1', role: 'owner' } }) },
      richMenuGroups: {
        ...actual.api.richMenuGroups,
        publishProgress: async () => net.progressResult,
        get: async () => ({ success: true, data: { id: 'g1', name: 'メニュー', accountId: 'account-1', status: 'published', isDefaultForAll: true, targetingEnabled: false } }),
        publishRuns: async () => ({ success: true, data: { runs: [] } }),
        previewTargets: async () => ({ success: true, data: null }),
        tapStats: async () => ({ success: true, data: { byArea: [] } }),
        reconcile: async () => ({ success: true, data: { diffs: [] } }),
        publish: net.publish,
      },
    },
  }
})

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(async () => {
  document.documentElement.dataset.theme = 'v8'
  net.publish.mockReset()
  net.publish.mockResolvedValue({ success: true, data: { pages: [] } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  delete document.documentElement.dataset.theme
})

function failedProgress() {
  return {
    success: true,
    data: {
      run: { id: 'run-1', mode: 'publish', status: 'failed', startedAt: '2026-09-27T00:00:00', completedAt: '2026-09-27T00:01:00' },
      steps: [
        { key: 'image', label: '画像をLINEに上げる', status: 'done' },
        { key: 'menu', label: 'メニューを作る', status: 'done' },
        { key: 'assign', label: '友だちに割り当てる', status: 'failed' },
        { key: 'cleanup', label: '前のメニューを片付ける', status: 'pending' },
      ],
      message: '割り当てに失敗したので、作ったメニューをLINEから消し、前のメニューのままにしました。もう一度公開できます。',
    },
  }
}

describe('公開の進み', () => {
  it('読み込み中はその旨だけ出す', async () => {
    net.progressResult = new Promise(() => {})
    await act(async () => {
      root.render(<RichMenuDetailV8 groupId="g1" />)
    })
    await flush()
    expect(screen.getByRole('region', { name: '公開の進み' }).querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('読めないときは飾りの赤を出さず、読み込めなかったとだけ出す', async () => {
    net.progressResult = Promise.reject(new Error('down'))
    await act(async () => {
      root.render(<RichMenuDetailV8 groupId="g1" />)
    })
    await flush()
    expect(container.textContent).toContain('公開の進みを読み込めませんでした。')
  })

  it('まだ公開していなければその旨を出す', async () => {
    net.progressResult = {
      success: true,
      data: {
        run: null,
        steps: [
          { key: 'image', label: '画像をLINEに上げる', status: 'pending' },
          { key: 'menu', label: 'メニューを作る', status: 'pending' },
          { key: 'assign', label: '友だちに割り当てる', status: 'pending' },
          { key: 'cleanup', label: '前のメニューを片付ける', status: 'pending' },
        ],
        message: 'まだ公開していません。',
      },
    }
    await act(async () => {
      root.render(<RichMenuDetailV8 groupId="g1" />)
    })
    await flush()
    expect(container.textContent).toContain('まだ公開していません。')
    expect(container.textContent).not.toContain('もう一度公開する')
  })

  it('失敗した段だけ失敗にし、もう一度公開するボタンで親へつなぐ', async () => {
    net.progressResult = failedProgress()
    await act(async () => {
      root.render(<RichMenuDetailV8 groupId="g1" />)
    })
    await flush()

    const text = container.textContent ?? ''
    expect(text).toContain('画像をLINEに上げる')
    expect(text).toContain('失敗')
    expect(text).toContain('前のメニューのままにしました')

    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === 'もう一度公開する')
    expect(button).toBeTruthy()
    await act(async () => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(net.publish).toHaveBeenCalledTimes(1)
    expect(net.publish).toHaveBeenCalledWith('g1', expect.any(String))
  })

  it('成功すればボタンを出さない', async () => {
    net.progressResult = {
      success: true,
      data: {
        run: { id: 'run-1', mode: 'publish', status: 'succeeded', startedAt: '2026-09-27T00:00:00', completedAt: '2026-09-27T00:01:00' },
        steps: [
          { key: 'image', label: '画像をLINEに上げる', status: 'done' },
          { key: 'menu', label: 'メニューを作る', status: 'done' },
          { key: 'assign', label: '友だちに割り当てる', status: 'done' },
          { key: 'cleanup', label: '前のメニューを片付ける', status: 'skipped' },
        ],
        message: null,
      },
    }
    await act(async () => {
      root.render(<RichMenuDetailV8 groupId="g1" />)
    })
    await flush()
    expect(container.textContent).toContain('済み')
    expect(container.textContent).not.toContain('もう一度公開する')
  })
})
