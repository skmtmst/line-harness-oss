// @vitest-environment happy-dom
/*
 * R531: 下書き編集画面でURLの対象IDが変わっても、前の下書きと保存先が残らない。
 * 同じ画面を開いたまま A→B へ変わると、B の編集器に切り替わる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

let currentQuery = 'id=draft-a'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(currentQuery),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: vi.fn(),
}))

/* 編集器の中身ではなく、渡るID（表示対象＝保存先）だけを見る。 */
vi.mock('@/components/automations/automation-draft-editor', () => ({
  default: ({ draftId }: { draftId: string }) => <div data-draft-id={draftId}>editor:{draftId}</div>,
}))

import AutomationDraftPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

async function renderPage() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<AutomationDraftPage />)
  })
}

describe('R531 対象IDが変わったら下書き編集も切り替わる', () => {
  it('A→Bへ変わるとBの編集器になりAは残らない', async () => {
    currentQuery = 'id=draft-a'
    await renderPage()
    expect(host.textContent).toContain('editor:draft-a')

    currentQuery = 'id=draft-b'
    await act(async () => {
      root.render(<AutomationDraftPage />)
    })
    expect(host.textContent).toContain('editor:draft-b')
    expect(host.textContent).not.toContain('editor:draft-a')

    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('IDが無いときは理由を出す', async () => {
    currentQuery = ''
    await renderPage()
    expect(host.textContent).toContain('開く下書きが指定されていません')

    act(() => {
      root.unmount()
    })
    host.remove()
  })
})
