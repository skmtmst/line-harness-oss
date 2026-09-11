// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import FolderPanel from './folder-panel'

/**
 * フォルダ件数の `null`（「数えていない」#631）を、本物のReactで確かめる。
 *
 * 文字列を読むだけの契約試験では、`{row.count}` が実際に `—` を描画するか
 * までは見ていない。ここは `react-dom/client` で実mountし、DOMに出る
 * 文字だけを見る。
 */

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
})

async function render(rows: Array<{ id: string; label: string; count: number | null }>) {
  await act(async () => {
    root.render(
      <FolderPanel
        rows={rows}
        activeId=""
        onSelect={() => {}}
        // 「—」を含まない値にする。total 自体の文字が row の検証に紛れないため。
        total="合計"
      />,
    )
  })
}

/** rows の各ボタン(id順)のテキストだけを見る。total や見出しを含めない。 */
function rowTexts(): string[] {
  return Array.from(host.querySelectorAll('nav button')).map((el) => el.textContent ?? '')
}

describe('FolderPanel の件数表示(#631)', () => {
  it('count が null の行は「—」を出し、数を嘘つかない', async () => {
    await render([
      { id: '', label: 'すべて', count: null },
      { id: 'f1', label: 'フォルダ1', count: null },
    ])
    const [allRow, folderRow] = rowTexts()
    expect(allRow).toContain('—')
    expect(folderRow).toContain('—')
    // 「0」と紛れないことも見る。0件と「数えていない」は別物。
    expect(allRow).not.toMatch(/\b0\b/)
    expect(folderRow).not.toMatch(/\b0\b/)
  })

  it('count が数値の行はその数をそのまま出す(0件も0件のまま、—にしない)', async () => {
    await render([
      { id: '', label: 'すべて', count: 12 },
      { id: 'f1', label: 'フォルダ1', count: 0 },
    ])
    const [allRow, folderRow] = rowTexts()
    expect(allRow).toContain('12')
    expect(allRow).not.toContain('—')
    expect(folderRow).toContain('0')
    expect(folderRow).not.toContain('—')
  })
})
