// @vitest-environment happy-dom
/*
 * N-014: ダッシュボード編集とQRダイアログのoverlay作法。
 *
 * 2つの独自overlayに共通部品と同じ useOverlayFocus を接続したかを、
 * 文字合わせではなく実Reactで開いてキー操作まで通して確かめる。
 * 見るのは Escapeで閉じる・Tabが外へ出ない・背景スクロール停止・
 * 閉じたら起点へフォーカスが戻る・保存中は閉じられない、の5点。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardEditor, { defaultDashboardPreferences } from './dashboard-editor'
import QrDialog from './qr-dialog'

// 共通部品側は React を import していないため、この環境では素の select へ
// 置き換える。フォーカス移動の対象としては同じ形なので試験の意味は変わらない。
vi.mock('@/components/shared/select-field', () => ({
  default: ({ id, value, options }: {
    id?: string
    value?: string
    options: { value: string; label: string }[]
  }) => (
    <select id={id} defaultValue={value}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}))
// QR画像の生成はoverlayの試験対象ではない。canvasの無い環境でも落ちないよう差し替える。
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,x') } }))

let host: HTMLDivElement
let root: Root
let opener: HTMLButtonElement

const prefs = defaultDashboardPreferences()

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  // 開いた起点。overlayを閉じたあと、ここへフォーカスが戻ることを見る。
  opener = document.createElement('button')
  opener.textContent = '開く'
  document.body.appendChild(opener)
  opener.focus()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  opener.remove()
  document.body.style.overflow = ''
  vi.restoreAllMocks()
})

const flush = () => act(async () => {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
})

const keydown = (key: string, shiftKey = false) => {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))
  })
}

const focusables = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ))

const dialog = () => {
  const node = host.querySelector<HTMLElement>('[role="dialog"]')
  if (!node) throw new Error('dialog not found')
  return node
}

describe('N-014 ダッシュボード編集overlay', () => {
  const mount = (saving = false, onCancel = vi.fn()) => {
    act(() => {
      root.render(
        <DashboardEditor
          open
          preferences={prefs}
          saving={saving}
          onCancel={onCancel}
          onApply={() => {}}
        />,
      )
    })
    return onCancel
  }

  it('開いている間は背景スクロールを止め、閉じたら元に戻す', async () => {
    mount()
    await flush()
    expect(document.body.style.overflow).toBe('hidden')
    await act(async () => { root.render(<div />) })
    expect(document.body.style.overflow).toBe('')
  })

  it('Escapeで閉じる', async () => {
    const onCancel = mount()
    await flush()
    keydown('Escape')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('保存中はEscape・背景クリック・閉じるボタンで閉じない', async () => {
    const onCancel = mount(true)
    await flush()
    keydown('Escape')
    expect(onCancel).not.toHaveBeenCalled()
    const overlay = host.firstElementChild as HTMLElement
    act(() => { overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(onCancel).not.toHaveBeenCalled()
    expect(dialog().querySelector<HTMLButtonElement>('button[aria-label="閉じる"]')?.disabled).toBe(true)
  })

  it('Tabは末尾から先頭へ、Shift+Tabは先頭から末尾へ循環する', async () => {
    mount()
    await flush()
    const panel = dialog()
    const items = focusables(panel)
    expect(items.length).toBeGreaterThan(2)
    // 末尾で Tab → 先頭へ戻る（外へ出ない）
    act(() => { items[items.length - 1].focus() })
    keydown('Tab')
    expect(document.activeElement).toBe(items[0])
    // 先頭で Shift+Tab → 末尾へ回る（外へ出ない）
    act(() => { items[0].focus() })
    keydown('Tab', true)
    expect(document.activeElement).toBe(items[items.length - 1])
    expect(panel.contains(document.activeElement)).toBe(true)
  })

  it('閉じたら開いた起点へフォーカスが戻る', async () => {
    mount()
    await flush()
    // 開いた直後はパネル内へフォーカスが入る
    expect(dialog().contains(document.activeElement)).toBe(true)
    await act(async () => { root.unmount() })
    expect(document.activeElement).toBe(opener)
    // 以後の試験に影響しないよう新しいrootを立て直す
    root = createRoot(host)
  })
})

describe('N-014 QRダイアログoverlay', () => {
  const mount = (onClose = vi.fn()) => {
    act(() => {
      root.render(
        <QrDialog
          open
          onClose={onClose}
          accountName="然-NEN- 公式"
          baseLink="https://line.me/R/ti/p/@nen"
          routes={[]}
        />,
      )
    })
    return onClose
  }

  it('開いている間は背景スクロールを止め、閉じたら元に戻す', async () => {
    mount()
    await flush()
    expect(document.body.style.overflow).toBe('hidden')
    await act(async () => { root.render(<div />) })
    expect(document.body.style.overflow).toBe('')
  })

  it('Escapeで閉じる', async () => {
    const onClose = mount()
    await flush()
    keydown('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Tabは末尾から先頭へ、Shift+Tabは先頭から末尾へ循環する', async () => {
    mount()
    await flush()
    const panel = dialog()
    const items = focusables(panel)
    expect(items.length).toBeGreaterThan(2)
    act(() => { items[items.length - 1].focus() })
    keydown('Tab')
    expect(document.activeElement).toBe(items[0])
    act(() => { items[0].focus() })
    keydown('Tab', true)
    expect(document.activeElement).toBe(items[items.length - 1])
    expect(panel.contains(document.activeElement)).toBe(true)
  })

  it('閉じたら開いた起点へフォーカスが戻る', async () => {
    mount()
    await flush()
    expect(dialog().contains(document.activeElement)).toBe(true)
    await act(async () => { root.unmount() })
    expect(document.activeElement).toBe(opener)
    root = createRoot(host)
  })
})
