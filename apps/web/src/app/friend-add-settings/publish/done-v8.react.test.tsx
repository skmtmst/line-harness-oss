// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import FriendAddDoneV8 from './done-v8'

/*
 * ★V8 友だち追加時の配信の有効化の完了（板 `e0FD1J`）の契約。
 * 公開したときの数（設定名・順番・知らせ）をそのまま出し、
 * 3つの行き先（一覧・流入リンク・実行結果）を持つ。
 */
let root: Root
let host: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

test('完了は板 e0FD1J・設定名・順番・3つの行き先が出る', async () => {
  await act(async () => root.render(
    <FriendAddDoneV8
      ruleName="秋フェアの初回案内"
      routeNames={['秋フェアチラシ', '秋フェア店頭ポスター']}
      priority={4}
      slackConnected
    />,
  ))
  expect(host.querySelector('[data-design-node="e0FD1J"]')).toBeTruthy()
  expect(host.textContent).toContain('「秋フェアの初回案内」を有効にしました')
  expect(host.textContent).toContain('4番目')
  expect(host.textContent).toContain('Slack（接続済み）')
  const links = [...host.querySelectorAll('a')].map((item) => item.getAttribute('href'))
  expect(links).toContain('/friend-add-settings')
  expect(links).toContain('/inflow-links')
  expect(links).toContain('/friend-add-settings/runs')
})
