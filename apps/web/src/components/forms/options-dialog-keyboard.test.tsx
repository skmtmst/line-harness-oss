// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OptionsDialog from './options-dialog'
import { FORM_OPTIONS_DEFAULT } from '@line-crm/shared'
import { EMPTY_REFS } from './form-refs'

vi.mock('@/components/shared/action-menu', () => ({ default: () => null }))

let host: HTMLDivElement
let root: Root
let opener: HTMLButtonElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  opener = document.createElement('button')
  opener.textContent = 'この版を公開'
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

const keydown = (key: string, shiftKey = false) => act(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))
})

const dialog = () => {
  const node = host.querySelector<HTMLElement>('[role="dialog"]')
  if (!node) throw new Error('dialog not found')
  return node
}

const focusables = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>(
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
))

function mount(onClose = vi.fn()) {
  act(() => {
    root.render(
      <OptionsDialog
        value={FORM_OPTIONS_DEFAULT}
        refs={EMPTY_REFS}
        onChange={() => {}}
        onClose={onClose}
        onSave={async () => {}}
      />,
    )
  })
  return onClose
}

describe('R198 オプション設定ダイアログのキーボード操作', () => {
  it('Escapeで閉じる', async () => {
    const onClose = mount()
    await flush()
    keydown('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Tab/Shift+Tabはダイアログ内を循環し、背後の公開ボタンへ抜けない', async () => {
    mount()
    await flush()
    const panel = dialog()
    const items = focusables(panel)
    expect(items.length).toBeGreaterThan(2)
    act(() => { items[items.length - 1].focus() })
    keydown('Tab')
    expect(document.activeElement).toBe(items[0])
    expect(panel.contains(document.activeElement)).toBe(true)
    act(() => { items[0].focus() })
    keydown('Tab', true)
    expect(document.activeElement).toBe(items[items.length - 1])
    expect(document.activeElement).not.toBe(opener)
  })

  it('閉じると開いた起点へフォーカスを戻す', async () => {
    mount()
    await flush()
    await act(async () => { root.render(<div />) })
    expect(document.activeElement).toBe(opener)
  })
})
