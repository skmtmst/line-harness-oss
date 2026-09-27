// @vitest-environment happy-dom
/*
 * T: 版の履歴の引き出し。主な状態（読み込み中・空・失敗・正常）を描く。
 * 中身の札・比べ・戻すは共通部品の試験が持つ。ここでは配線だけ見る。
 */
import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  listMenuVersions: null as null | (() => Promise<unknown>),
  revertMenuVersion: null as null | ((...args: unknown[]) => Promise<unknown>),
}))

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number
    constructor(status: number, message?: string) {
      super(message || `API error: ${status}`)
      this.name = 'ApiError'
      this.status = status
    }
  }
  return {
    ApiError,
    bookingApi: {
      listMenuVersions: (...args: unknown[]) => fixture.listMenuVersions?.(...args),
      revertMenuVersion: (...args: unknown[]) => fixture.revertMenuVersion?.(...args),
    },
  }
})

import MenuVersionHistory from './menu-version-history'

afterEach(() => {
  cleanup()
  fixture.listMenuVersions = null
  fixture.revertMenuVersion = null
})

const VERSIONS = [
  {
    version_number: 2, title: '第2版', status: 'in_use',
    summary: '値段 1,000円→8,000円', author: '店長', at: '2026-09-27T10:00:00',
    lines: ['名前：カット', '値段：8,000円'],
  },
  {
    version_number: 1, title: '第1版', status: 'past',
    summary: '最初の版', author: null, at: '2026-09-20T10:00:00',
    lines: ['名前：カット', '値段：1,000円'],
  },
]

function renderHistory(props: Record<string, unknown> = {}) {
  const onReverted = vi.fn()
  const onClose = vi.fn()
  render(
    <MenuVersionHistory
      menuId="menu-a"
      menuName="カット"
      currentVersion={2}
      accountId="account-a"
      canRevert
      onReverted={onReverted}
      onClose={onClose}
      {...props}
    />,
  )
  return { onReverted, onClose }
}

describe('版の履歴の引き出し', () => {
  test('読み込み中はその旨を出す', () => {
    fixture.listMenuVersions = () => new Promise(() => {})
    renderHistory()
    expect(screen.getByText('版の履歴を読み込んでいます')).toBeTruthy()
  })

  test('正常時は版・札・ひとことが並ぶ', async () => {
    fixture.listMenuVersions = async () => ({ versions: VERSIONS })
    renderHistory()
    await waitFor(() => expect(screen.getByText('第2版')).toBeTruthy())
    expect(screen.getByText('使用中')).toBeTruthy()
    expect(screen.getByText('過去')).toBeTruthy()
    expect(screen.getByText('値段 1,000円→8,000円')).toBeTruthy()
  })

  test('空のときは「版はまだありません」と出す', async () => {
    fixture.listMenuVersions = async () => ({ versions: [] })
    renderHistory()
    await waitFor(() => expect(screen.getByText('版はまだありません。')).toBeTruthy())
  })

  test('失敗時は理由と読み直しを出す。読み直すと直る', async () => {
    fixture.listMenuVersions = async () => { throw new Error('no network') }
    renderHistory()
    await waitFor(() => expect(screen.getByText('版の履歴を読み込めませんでした。')).toBeTruthy())
    fixture.listMenuVersions = async () => ({ versions: VERSIONS })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    })
    await waitFor(() => expect(screen.getByText('第2版')).toBeTruthy())
  })

  test('いまと比べると変わった所が出る', async () => {
    fixture.listMenuVersions = async () => ({ versions: VERSIONS })
    renderHistory()
    await waitFor(() => expect(screen.getByText('第1版')).toBeTruthy())
    fireEvent.click(screen.getByText('第1版'))
    fireEvent.click(screen.getByText('いまと比べる'))
    expect(screen.getByText('第1版と第2版の比べ')).toBeTruthy()
  })

  test('この版に戻すと確認のうえ新しい版を作る', async () => {
    fixture.listMenuVersions = async () => ({ versions: VERSIONS })
    fixture.revertMenuVersion = vi.fn(async () => ({ ok: true, version: 3 }))
    const { onReverted } = renderHistory()
    await waitFor(() => expect(screen.getByText('第1版')).toBeTruthy())
    fireEvent.click(screen.getByText('第1版'))
    fireEvent.click(screen.getByText('この版に戻す'))
    await act(async () => {
      fireEvent.click(screen.getByText('新しい版を作る'))
    })
    await waitFor(() => expect(fixture.revertMenuVersion).toHaveBeenCalledWith('account-a', 'menu-a', 1, 2))
    expect(onReverted).toHaveBeenCalledWith(3)
  })

  test('権限がなければ戻せない旨を出す', async () => {
    fixture.listMenuVersions = async () => ({ versions: VERSIONS })
    renderHistory({ canRevert: false })
    await waitFor(() => expect(screen.getByText('第1版')).toBeTruthy())
    fireEvent.click(screen.getByText('第1版'))
    const revertButton = screen.getByText('この版に戻す').closest('button')
    expect(revertButton?.disabled).toBe(true)
  })
})
