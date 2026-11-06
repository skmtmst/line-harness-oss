// @vitest-environment happy-dom
/*
 * 共通情報の一覧・新規・編集は、共通情報の機能がオフのアカウントでは直URLでも開かない。
 * 登録メディアの一覧は別のキー（media）で閉じ、共通情報のキーには引きずられない。
 * 入口（page.tsx）を本物のゲートごと描き、中の画面は印だけに置き換えて見る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const visibility = vi.hoisted(() => ({ off: new Set<string>() }))

vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({
    status: 'ready',
    features: null,
    enabled: (key: string) => !visibility.off.has(key),
  }),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('@/v8/common-vars/list', () => ({ default: () => React.createElement('p', { 'data-screen': 'vars-list' }) }))
vi.mock('@/v8/common-vars-edit/new', () => ({ default: () => React.createElement('p', { 'data-screen': 'vars-new' }) }))
vi.mock('@/v8/common-vars-edit/edit', () => ({ default: () => React.createElement('p', { 'data-screen': 'vars-edit' }) }))
vi.mock('@/v8/contents/list', () => ({ default: () => React.createElement('p', { 'data-screen': 'media-list' }) }))

import MediaLibraryPage from '../page'
import EditCommonVarPage from './edit/page'
import NewCommonVarPage from './new/page'
import CommonVarsPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  visibility.off = new Set()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(Page: () => React.ReactElement) {
  await act(async () => { root.render(<Page />) })
}

const commonVarPages: Array<[string, () => React.ReactElement, string]> = [
  ['一覧', CommonVarsPage, 'vars-list'],
  ['新規', NewCommonVarPage, 'vars-new'],
  ['編集', EditCommonVarPage, 'vars-edit'],
]

describe('共通情報の画面は共通情報キーのゲートの内側にある', () => {
  it.each(commonVarPages)('%sは機能がオンなら画面を出す', async (_name, Page, screen) => {
    await render(Page)
    expect(host.querySelector(`[data-screen="${screen}"]`)).not.toBeNull()
    expect(host.querySelector('[data-feature-disabled]')).toBeNull()
  })

  it.each(commonVarPages)('%sは共通情報がオフなら画面を出さず、オフの案内にする', async (_name, Page, screen) => {
    visibility.off = new Set(['common_vars'])
    await render(Page)
    expect(host.querySelector(`[data-screen="${screen}"]`)).toBeNull()
    expect(host.querySelector('[data-feature-disabled="common_vars"]')).not.toBeNull()
  })

  it('登録メディアの一覧はメディアのキーで閉じ、共通情報のキーには引きずられない', async () => {
    visibility.off = new Set(['common_vars'])
    await render(MediaLibraryPage)
    expect(host.querySelector('[data-screen="media-list"]')).not.toBeNull()
    await act(async () => { root.unmount() })
    root = createRoot(host)
    visibility.off = new Set(['media'])
    await render(MediaLibraryPage)
    expect(host.querySelector('[data-screen="media-list"]')).toBeNull()
    expect(host.querySelector('[data-feature-disabled="media"]')).not.toBeNull()
  })
})
