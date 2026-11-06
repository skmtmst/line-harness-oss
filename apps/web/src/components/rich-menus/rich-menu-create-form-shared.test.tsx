// @vitest-environment happy-dom
/*
 * 統括の例外時のフォームも現役V8の共通部品で出す。
 * 本物のReactで動かして見る。
 * - 「出す相手」はラジオカード（素の青丸を直置きしない）
 * - 「既定メニュー」は共通チェックボックス（素の四角を直置きしない）
 * - 未設定の面は「未設定」の札＋「設定する」の文字ボタン（赤文字にしない）
 * - 未設定のまとめ行は警告色（失敗の赤にしない）
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import RichMenuCreateForm from './rich-menu-create-form'
import { freshRichMenuCreateValue } from './rich-menu-create-model'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

describe('例外時のフォームも現役の共通部品で出す', () => {
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  async function renderForm() {
    await act(async () => {
      root.render(<RichMenuCreateForm value={freshRichMenuCreateValue()} onChange={() => {}} audienceSetup />)
    })
  }

  it('出す相手はラジオカードで選ぶ', async () => {
    await renderForm()
    const legends = Array.from(host.querySelectorAll('fieldset legend')).map((el) => el.textContent)
    expect(legends).toContain('出す相手')
    const audience = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="radio"][name="create-audience"]'))
    expect(audience).toHaveLength(2)
    // 素の青丸の直置き（mt-1 の丸だけ）は残さない
    expect(host.querySelector('input[type="radio"].mt-1')).toBeNull()
    expect(host.textContent).toContain('すべての友だち')
    expect(host.textContent).toContain('条件に当てはまる友だちだけ')
  })

  it('既定メニューは共通チェックボックスで選ぶ', async () => {
    await renderForm()
    expect(host.textContent).toContain('公開したら「すべての友だち」の既定メニューにする')
    // 素の四角の直置き（mt-1 の四角だけ）は残さない
    expect(host.querySelector('input[type="checkbox"].mt-1')).toBeNull()
  })

  it('未設定の面は札と設定ボタンで出す（赤にしない）', async () => {
    await renderForm()
    expect(host.textContent).toContain('未設定')
    const setup = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '設定する')
    expect(setup).toBeTruthy()
    expect(host.textContent).not.toContain('アクションを設定する')
    // 未設定は失敗ではないので赤（text-danger）を使わない
    const areaSection = host.querySelector('[aria-label="押した面ごとの動き"]')
    expect(areaSection).toBeTruthy()
    expect(areaSection!.querySelector('[role="alert"]')).toBeNull()
    expect(areaSection!.querySelector('[data-design-part="notice"]')).not.toBeNull()
    expect(areaSection!.textContent).toContain('アクションが未設定です')
  })

  it('上の3欄（メニュー名・フォルダ・トーク画面の下の文言）は共通の入力で、名前と文言は書き換えられる', async () => {
    const changes: Array<{ name: string; chatBarText: string }> = []
    await act(async () => {
      root.render(<RichMenuCreateForm value={freshRichMenuCreateValue()} onChange={(next) => changes.push(next)} folders={[{ id: 'f-1', name: '会員向け' }]} />)
    })
    const name = host.querySelector<HTMLInputElement>('#rich-menu-name')!
    const chatBar = host.querySelector<HTMLInputElement>('#rich-menu-chat-bar-text')!
    expect(host.querySelector(`label[for="rich-menu-name"]`)?.textContent).toContain('メニュー名')
    expect(host.querySelector(`label[for="rich-menu-chat-bar-text"]`)?.textContent).toContain('トーク画面の下の文言')
    expect(host.querySelector('[aria-label="フォルダ"]')).not.toBeNull()
    expect(chatBar.maxLength).toBe(14)
    await act(async () => {
      fireEvent.change(name, { target: { value: '会員メニュー' } })
      fireEvent.change(chatBar, { target: { value: 'ひらく' } })
    })
    expect(changes.map((next) => next.name)).toContain('会員メニュー')
    expect(changes.map((next) => next.chatBarText)).toContain('ひらく')
  })
})
