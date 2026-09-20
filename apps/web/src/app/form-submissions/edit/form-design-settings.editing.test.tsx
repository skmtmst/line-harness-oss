// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FORM_THEME_DEFAULT, type FormTheme } from '@line-crm/shared'
import Dialog from '@/components/shared/dialog'
import FormDesignSettings from './form-design-settings'

/*
 * DEEP-12/13/14/15: 回答フォームのデザイン設定と共通Dialog。
 *
 * - DEEP-12: カラーコード欄は1文字ずつ編集でき、確定時だけ検証する
 * - DEEP-13: 「おまかせ」は配色だけ、「元に戻す」は開いた時点の全値へ
 * - DEEP-14: 独自の窓にも Esc・Tab・フォーカス復帰が効く
 * - DEEP-15: open=true で初回マウントした Dialog でも Tab が portal 内を回る
 */

const router = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  router.replace.mockReset()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  // Dialog は body 直下へ portal する。残ると次の試験へ混ざる。
  document.body.querySelectorAll('[data-design-part="dialog"]').forEach((node) => node.remove())
  vi.restoreAllMocks()
})

type Handlers = {
  onChange: ReturnType<typeof vi.fn>
  onOgTitleChange: ReturnType<typeof vi.fn>
  onOgDescriptionChange: ReturnType<typeof vi.fn>
  onOgImageUrlChange: ReturnType<typeof vi.fn>
}

async function render(overrides: {
  value?: FormTheme
  ogTitle?: string
  ogDescription?: string
  ogImageUrl?: string
} = {}) {
  const handlers: Handlers = {
    onChange: vi.fn(),
    onOgTitleChange: vi.fn(),
    onOgDescriptionChange: vi.fn(),
    onOgImageUrlChange: vi.fn(),
  }
  await act(async () => {
    root.render(
      <FormDesignSettings
        formId="form-1"
        accountId={null}
        value={overrides.value}
        ogTitle={overrides.ogTitle ?? ''}
        ogDescription={overrides.ogDescription ?? ''}
        ogImageUrl={overrides.ogImageUrl ?? ''}
        {...handlers}
      />,
    )
  })
  return handlers
}

async function eventually(check: () => void, timeout = 1_500): Promise<void> {
  const started = Date.now()
  while (true) {
    try {
      check()
      return
    } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
}

/** React が握っている value を飛ばして、本物の入力と同じ形で文字を入れる。 */
async function type(element: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const proto = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  await act(async () => {
    setter.call(element, text)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const colorCodeInput = (label: string) =>
  host.querySelector<HTMLInputElement>(`input[aria-label="${label}のカラーコード"]`)
/** React の onBlur はバブルする focusout で届く。実ブラウザの Tab 移動と同じ経路。 */
const blur = async (element: HTMLElement) => {
  await act(async () => {
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}
const keydown = (key: string, shiftKey = false) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))
const clickButton = async (text: string) => {
  const button = Array.from(host.querySelectorAll('button'))
    .find((b) => b.textContent?.trim() === text)
  expect(button, `ボタン「${text}」`).toBeTruthy()
  await act(async () => { button!.click() })
}

describe('DEEP-12 カラーコードは1文字ずつ編集できる', () => {
  it('末尾を消しても空にしても入力が残り、テーマは動かない', async () => {
    const handlers = await render()
    const input = colorCodeInput('メイン')!
    expect(input.value).toBe(FORM_THEME_DEFAULT.main)

    await type(input, '#008f3')
    expect(input.value).toBe('#008f3')
    await type(input, '')
    expect(input.value).toBe('')
    expect(handlers.onChange).not.toHaveBeenCalled()
  })

  it('確定で有効な値だけテーマへ反映し、無効なら入力を残して欄の下へエラーを出す', async () => {
    const handlers = await render()
    const input = colorCodeInput('アクセント')!

    // 大文字も受理し、確定で小文字へそろえる。
    await type(input, '#ABCDEF')
    await blur(input)
    expect(handlers.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ accent: '#abcdef' }),
    )

    // 無効なコードは確定しても反映せず、入力とエラーを残す。
    await type(input, '#12')
    await blur(input)
    expect(input.value).toBe('#12')
    expect(host.querySelector('#form-theme-accent-error')?.textContent).toContain('16進数')
    expect(handlers.onChange).toHaveBeenCalledTimes(1)
  })

  it('Enter でも確定できる', async () => {
    const handlers = await render()
    const input = colorCodeInput('文字')!
    await type(input, '#123456')
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(handlers.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ text: '#123456' }),
    )
  })
})

describe('DEEP-13 おまかせと元に戻すは全テーマを初期化しない', () => {
  const customTheme: FormTheme = {
    ...FORM_THEME_DEFAULT,
    main: '#111111',
    fontFamily: 'serif',
    cornerRadius: 'round',
    backgroundImageUrl: 'https://example.test/bg.png',
  }

  it('「おまかせで組む」は5色だけを既定へ戻し、書体・角丸・背景画像を残す', async () => {
    const handlers = await render({ value: customTheme })
    await clickButton('おまかせで組む')
    expect(handlers.onChange).toHaveBeenCalledWith({
      ...customTheme,
      main: FORM_THEME_DEFAULT.main,
      sub: FORM_THEME_DEFAULT.sub,
      accent: FORM_THEME_DEFAULT.accent,
      error: FORM_THEME_DEFAULT.error,
      text: FORM_THEME_DEFAULT.text,
    })
  })

  it('「元に戻す」は開いた時点の全値へ戻す', async () => {
    const handlers = await render({
      value: customTheme,
      ogTitle: '開いた時点の見出し',
      ogDescription: '開いた時点の説明',
      ogImageUrl: 'https://example.test/og.png',
    })
    await clickButton('元に戻す')
    expect(handlers.onChange).toHaveBeenCalledWith(customTheme)
    expect(handlers.onOgTitleChange).toHaveBeenCalledWith('開いた時点の見出し')
    expect(handlers.onOgDescriptionChange).toHaveBeenCalledWith('開いた時点の説明')
    expect(handlers.onOgImageUrlChange).toHaveBeenCalledWith('https://example.test/og.png')
  })

  it('全初期化は「初期設定に戻す」として別の操作に置く', async () => {
    const handlers = await render({ value: customTheme })
    await clickButton('初期設定に戻す')
    expect(handlers.onChange).toHaveBeenCalledWith({ ...FORM_THEME_DEFAULT })
  })
})

describe('DEEP-14 デザイン設定のキーボード操作', () => {
  it('Escape で閉じて編集画面の基本タブへ戻る', async () => {
    await render()
    await act(async () => { keydown('Escape') })
    expect(router.replace).toHaveBeenCalledWith(
      `/form-submissions/edit?id=${encodeURIComponent('form-1')}&tab=basic`,
    )
  })

  it('Tab は窓の中で回り、末尾の次は先頭へ戻る', async () => {
    await render()
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>('button, input, select, textarea'),
    ).filter((el) => !el.hasAttribute('disabled'))
    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    // 初回フォーカスは窓の先頭へ入る
    await eventually(() => expect(document.activeElement).toBe(first))

    await act(async () => { last.focus(); keydown('Tab') })
    expect(document.activeElement).toBe(first)

    await act(async () => { first.focus(); keydown('Tab', true) })
    expect(document.activeElement).toBe(last)
  })
})

describe('DEEP-15 open=true で初回マウントする Dialog', () => {
  it('portal へ移ったあとの面で Tab が最前面内に留まる', async () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    await act(async () => {
      root.render(
        <Dialog open title="確認" onCancel={onCancel} onConfirm={onConfirm}>
          <p>本文</p>
        </Dialog>,
      )
    })

    // portal 完了を待ってから、document.body 側の実DOMで確かめる。
    let panel: HTMLElement | null = null
    await eventually(() => {
      panel = document.body.querySelector<HTMLElement>('[data-design-part="dialog"]')
      expect(panel).toBeTruthy()
    })
    const focusable = Array.from(
      panel!.querySelectorAll<HTMLElement>('button, input, select, textarea'),
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    await eventually(() => expect(document.activeElement).toBe(first))
    await act(async () => { last.focus(); keydown('Tab') })
    expect(document.activeElement).toBe(first)
    await act(async () => { first.focus(); keydown('Tab', true) })
    expect(document.activeElement).toBe(last)

    await act(async () => { keydown('Escape') })
    expect(onCancel).toHaveBeenCalled()
  })
})
