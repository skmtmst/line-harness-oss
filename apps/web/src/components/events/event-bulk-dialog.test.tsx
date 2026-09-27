// @vitest-environment happy-dom
/*
 * R84: 一括予約枠の入力が増えると閉じる・生成・キャンセルが画面外へ出た回帰試験。
 *
 * 以前は手作りの fixed overlay で、最大高さも内部スクロールも Escape も無かった。
 * 共通 Dialog を使うことで、見る筋書き:
 *   1. 窓は dialog として出て、閉じる・キャンセル・生成が文書に残る
 *   2. 時刻パターンを12件に増やしても、操作ボタンが文書に残る
 *   3. Escape で閉じられる
 *   4. 「生成」で入力が渡る
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BulkSlotDialog } from './event-form'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  document.body.innerHTML = ''
})

async function renderDialog(onClose = vi.fn(), onSubmit = vi.fn(async () => {})) {
  await act(async () => { root.render(<BulkSlotDialog onClose={onClose} onSubmit={onSubmit} />) })
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
  return { onClose, onSubmit }
}

function button(text: string): HTMLElement {
  const found = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  expect(found, `「${text}」ボタンがある`).toBeTruthy()
  return found as HTMLElement
}

describe('R84 一括追加の窓は増えても操作できる', () => {
  it('窓は dialog として出て、閉じる・キャンセル・生成がある', async () => {
    await renderDialog()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog, 'dialog がある').toBeTruthy()
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(document.querySelector('[aria-label="閉じる"]'), '右上の×がある').toBeTruthy()
    button('キャンセル')
    button('生成')
  })

  it('時刻パターンを12件に増やしても操作ボタンが残り、Escape で閉じる', async () => {
    const { onClose } = await renderDialog()
    for (let i = 0; i < 11; i += 1) {
      await act(async () => { button('＋ パターン追加').click() })
    }
    expect(document.querySelectorAll('[aria-label$="件目の開始"]')).toHaveLength(12)
    // 増えても操作は文書に残る（以前は画面外へ出た）。
    button('キャンセル')
    button('生成')
    expect(document.querySelector('[aria-label="閉じる"]'), '右上の×が残る').toBeTruthy()
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(onClose).toHaveBeenCalled()
  })

  it('「生成」で入力が渡る', async () => {
    const { onSubmit } = await renderDialog()
    await act(async () => { button('生成').click() })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ time_patterns: [{ start: '10:00', end: '11:00' }] })
  })
})
