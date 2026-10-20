// @vitest-environment happy-dom
// @vitest-environment-options { "url": "http://localhost/rich-menus/edit/" }
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RichMenuCreateV8 from '../../../v8/rich-menus/new/create'

/**
 * 現役の公開手順で自前・LINE・実機・ページ数を確認する。
 * 実際の取得・確認の記録・LINEへの検査と、取得失敗の扱いを守る。
 */

const net = vi.hoisted(() => ({
  checkResult: undefined as unknown,
  validateResult: undefined as unknown,
  confirmResult: undefined as unknown,
  checkError: false,
  confirmDevice: vi.fn(),
  validatePublish: vi.fn(),
}))

const account = { id: 'account-1', name: 'テスト店' }
const group = {
  id: 'g1', accountId: account.id, name: 'メニュー', chatBarText: 'メニュー',
  size: 'large', defaultPageId: 'p1', isDefaultForAll: false, status: 'draft',
  targetingCondition: null, targetingPriority: 0, targetingEnabled: false,
  folderId: null, defaultOpen: true, version: 1,
  pages: [{ id: 'p1', orderIndex: 0, name: '1枚目', aliasId: '', lineRichmenuId: null, imageR2Key: 'img', imageContentType: 'image/jpeg', areas: [] }],
}
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccount: account, selectedAccountId: account.id, accounts: [account], loading: false }),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: { ...actual.api.staff, me: async () => ({ success: true, data: { id: 'owner-1', role: 'owner' } }) },
      folders: { ...actual.api.folders, list: async () => ({ success: true, data: [] }) },
      tags: { ...actual.api.tags, list: async () => ({ success: true, data: [] }) },
      templates: { ...actual.api.templates, list: async () => ({ success: true, data: [] }) },
      forms: { ...actual.api.forms, list: async () => ({ success: true, data: [] }) },
      trackedLinks: { ...actual.api.trackedLinks, list: async () => ({ success: true, data: [] }) },
      richMenuGroups: {
        ...actual.api.richMenuGroups,
        get: async () => ({ success: true, data: group }),
        list: async () => ({ success: true, data: [] }),
        previewTargets: async () => ({ success: true, data: null }),
        prepublishCheck: async () => { if (net.checkError) throw new Error('down'); return net.checkResult },
        validatePublish: net.validatePublish,
        confirmDevice: net.confirmDevice,
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
  return act(async () => {
    fireEvent.click(screen.getByRole('button', { name: label }))
  })
}

beforeEach(async () => {
  document.documentElement.dataset.theme = 'v8'
  window.history.replaceState(null, '', '/rich-menus/edit?id=g1&step=publish')
  net.checkError = false
  net.confirmDevice.mockReset().mockImplementation(async () => net.confirmResult)
  net.validatePublish.mockReset().mockImplementation(async () => net.validateResult)
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
  delete document.documentElement.dataset.theme
})

describe('公開の前の確認', () => {
  it('自前・LINE・実機の確認とページ数を出す', async () => {
    net.checkResult = unchecked()
    await act(async () => {
      root.render(<RichMenuCreateV8 editGroupId="g1" />)
    })
    await flush()

    const text = container.textContent ?? ''
    expect(text).toContain('自前の検査')
    expect(text).toContain('LINE の検査')
    expect(text).toContain('スマホの LINE で見た')
    expect(screen.getByTitle('ページ数: 1 / 10')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '見直す' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'スマホで見た' })).toBeTruthy()
  })

  it('実機で見たを押すと確認済みになる', async () => {
    net.checkResult = unchecked()
    await act(async () => {
      root.render(<RichMenuCreateV8 editGroupId="g1" />)
    })
    await flush()
    expect(container.textContent).toContain('管理画面の見本だけでは公開できません')

    await click('スマホで見た')
    await flush()
    expect(net.confirmDevice).toHaveBeenCalledExactlyOnceWith('g1')
    expect(container.textContent).toContain('スマホの実機で確認済みです')
  })

  it('LINEの検査を通すと結果が出る', async () => {
    net.checkResult = unchecked()
    await act(async () => {
      root.render(<RichMenuCreateV8 editGroupId="g1" />)
    })
    await flush()

    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: '見直す' })[1]) })
    await flush()
    expect(net.validatePublish).toHaveBeenCalledExactlyOnceWith('g1')
    expect(container.textContent).toContain('LINEの受付に通りました。')
  })

  it('読めないときは読み込めなかったとだけ出す', async () => {
    net.checkError = true
    await act(async () => {
      root.render(<RichMenuCreateV8 editGroupId="g1" />)
    })
    await flush()
    expect(container.textContent).toContain('確認の状態を読み込めませんでした。')
  })
})
