// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 公開履歴セクションの「応答の形がずれていたとき」の試験(#1056)。
 *
 * publish-runs の応答が success: true でも runs を欠く形（旧APIや途中の
 * プロキシ応答）だと、以前は runs=undefined が state に入り、描画側の
 * runs.length で画面ごと落ちていた。落ちる代わりに読み込み失敗として
 * 表示することを確かめる。差し替えるのは通信(api)だけ。
 */

const net = vi.hoisted(() => ({
  /** 次の publishRuns 応答。 */
  publishRunsResult: undefined as unknown,
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      richMenuGroups: {
        ...actual.api.richMenuGroups,
        publishRuns: async () => net.publishRunsResult,
      },
    },
  }
})

const { PublishHistorySection } = await import('./publish-history')

// act(...) を使う環境だと React に伝える(伝えないと警告が出続ける)。
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
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
})

describe('公開履歴の読み込み（応答の形ずれ）', () => {
  it('runs を欠く応答では画面を落とさず、読み込み失敗として表示する', async () => {
    net.publishRunsResult = { success: true, data: {} }

    await act(async () => {
      root.render(<PublishHistorySection groupId="menu-1" />)
    })
    await flush()

    expect(container.textContent).toContain('公開履歴を読み込めませんでした。')
  })

  it('通常の形の応答では履歴を表示する', async () => {
    net.publishRunsResult = {
      success: true,
      data: {
        runs: [],
        published: null,
        draftDiffersFromPublished: null,
      },
    }

    await act(async () => {
      root.render(<PublishHistorySection groupId="menu-1" />)
    })
    await flush()

    expect(container.textContent).toContain('まだ公開の履歴はありません。')
  })
})
