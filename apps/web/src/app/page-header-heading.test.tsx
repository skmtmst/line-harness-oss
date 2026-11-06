// @vitest-environment happy-dom
/*
 * 既存の PageHeader も共通の見出し（PageHeading）で頭を出す。
 * 題は見出し1つだけで、全文は title で確かめられ、説明は「？」の中へ入る。
 * 頭を画面ごとに手書きすると、本文とトップバーで画面名が2回出る道が増える
 * （no-duplicate-page-title-contract.test.ts の全画面の見張りと組で守る）。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import PageHeader from '@/components/shared/page-header'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

it('PageHeader は題を見出し1つで出し、全文を title に持ち、説明は「？」の中に置く', async () => {
  await act(async () => {
    root.render(<PageHeader breadcrumb={[{ label: '設定', href: '/settings' }]} title="会員の一覧" help="会員を探して開きます。" />)
  })
  const headings = [...host.querySelectorAll('h1, h2')]
  expect(headings).toHaveLength(1)
  expect(headings[0].textContent).toBe('会員の一覧')
  expect(headings[0].getAttribute('title')).toBe('会員の一覧')
  expect(host.querySelector('button[aria-label="会員の一覧の説明"]')).not.toBeNull()
  expect(host.textContent).not.toContain('会員を探して開きます。')
})
