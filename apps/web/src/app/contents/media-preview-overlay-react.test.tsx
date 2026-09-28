// @vitest-environment happy-dom
/*
 * メディアのプレビュー窓の振る舞い（監査R222）。
 * 以前は固定配置の自前オーバーレイで、Escapeで閉じない・Tabが窓の外へ
 * 抜ける・閉じても開いたボタンへ焦点が戻らなかった。共有の
 * useOverlayFocus に乗せて、窓の約束を他の窓と揃えた。
 */
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import MediaPreviewOverlay from './media-preview-overlay'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function Harness() {
  const [preview, setPreview] = useState(false)
  return (
    <>
      <button type="button" id="open-preview" onClick={() => setPreview(true)}>プレビューを見る</button>
      <button type="button" id="other">別の操作</button>
      {preview && (
        <MediaPreviewOverlay
          filename="photo.png"
          kind="file"
          src="/media/photo.png"
          onClose={() => setPreview(false)}
        />
      )}
    </>
  )
}

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
}

async function pressKey(key: string, shiftKey = false) {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))
  })
}

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  host?.remove()
})

describe('メディアのプレビュー窓(R222, 実React)', () => {
  it('開くと窓の中に焦点が入り、Escape・×・背景で閉じ、開いたボタンへ戻る', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => { root.render(<Harness />) })
    await settle()

    const opener = document.getElementById('open-preview') as HTMLButtonElement
    opener.focus()
    await act(async () => { opener.click() })
    await settle()

    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    // 最初に窓の中（右上の×）へ焦点が入る。
    const closeButton = Array.from(document.querySelectorAll('button')).find(
      (el) => el.getAttribute('aria-label') === 'プレビューを閉じる',
    ) as HTMLButtonElement
    expect(closeButton).toBeTruthy()
    expect(document.activeElement === closeButton || dialog!.contains(document.activeElement)).toBe(true)

    // Escape で閉じて、開いたボタンへ焦点が戻る。
    await pressKey('Escape')
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('Tabは窓の中で回り、Shift+Tabも外へ抜けない', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => { root.render(<Harness />) })
    await settle()

    const opener = document.getElementById('open-preview') as HTMLButtonElement
    await act(async () => { opener.click() })
    await settle()

    const dialog = document.querySelector('[role="dialog"]')!
    const inside = Array.from(dialog.querySelectorAll('button, a'))
    expect(inside.length).toBeGreaterThanOrEqual(2) // × と「別のタブで開く」

    // 末尾へ移して Tab → 先頭へ戻る。
    ;(inside[inside.length - 1] as HTMLElement).focus()
    await pressKey('Tab')
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(inside[0])

    // 先頭から Shift+Tab → 末尾へ回る。
    await pressKey('Tab', true)
    expect(document.activeElement).toBe(inside[inside.length - 1])
  })

  it('右上の×で閉じられる', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => { root.render(<Harness />) })
    await settle()

    await act(async () => { (document.getElementById('open-preview') as HTMLButtonElement).click() })
    await settle()

    const closeButton = Array.from(document.querySelectorAll('button')).find(
      (el) => el.getAttribute('aria-label') === 'プレビューを閉じる',
    ) as HTMLButtonElement
    await act(async () => { closeButton.click() })
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
