// @vitest-environment happy-dom
/*
 * ★V8 CTA・フォーム（`Q0Jrk`）の描画。
 * 差し替えるのは通信だけ。カードの一覧・選んだカードの欄・申込フォームが実在する。
 */
import { fireEvent } from '@testing-library/react'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  editor: vi.fn(),
  ctas: vi.fn(),
  saveCtas: vi.fn(),
  saveEditor: vi.fn(),
  fetchApi: vi.fn(),
  role: 'admin',
}))

vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => apiMocks.role, canManageRole: (role: string) => role === 'owner' || role === 'admin' }))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    fetchApi: apiMocks.fetchApi,
    webinarApi: {
      editor: apiMocks.editor,
      ctas: apiMocks.ctas,
      saveCtas: apiMocks.saveCtas,
      saveEditor: apiMocks.saveEditor,
    },
  }
})

import CtaV8 from './cta-v8'
import { ApiError, type WebinarEditor } from '@/lib/api'

const EDITOR = { version: 5, registrationFormId: null } as WebinarEditor

const roots: Root[] = []
function render(props: Partial<Pick<React.ComponentProps<typeof CtaV8>, 'onDirtyChange' | 'registerSave' | 'onEditorChange'>> = {}): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root: Root = createRoot(host)
  roots.push(root)
  act(() => {
    root.render(
      <CtaV8
        webinarId="webinar-1"
        accountId="account-1"
        durationSeconds={3600}
        editor={EDITOR}
        onEditorChange={() => undefined}
        {...props}
      />,
    )
  })
  return host
}

describe('CTA・フォームのV8（Q0Jrk）', () => {
  beforeEach(() => {
    apiMocks.role = 'admin'
    apiMocks.ctas.mockResolvedValue({
      data: [
        {
          atSeconds: 720,
          kind: 'form',
          title: '個別導入診断、受付中です',
          body: null,
          buttonLabel: '無料で診断を受ける',
          autoOpen: true,
          formId: 'form-1',
          url: null,
        },
      ],
    })
    apiMocks.fetchApi.mockResolvedValue({ success: true, data: [] })
  })

  afterEach(() => {
    act(() => { for (const root of roots.splice(0)) root.unmount() })
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('板IDとカードの一覧・申込フォームを描く', async () => {
    const host = render()
    await act(async () => undefined)
    expect(host.querySelector('[data-design-node="Q0Jrk"]')).not.toBeNull()
    expect(host.textContent).toContain('CTAカード 1枚')
    expect(host.textContent).toContain('個別導入診断、受付中です')
    expect(host.textContent).toContain('申込に使う回答フォーム')
    expect(host.textContent).toContain('カードの見え方')
  })

  it('閲覧のみではカードを選んで確認でき、入力・追加・保存を止める', async () => {
    apiMocks.role = 'staff'
    apiMocks.fetchApi.mockResolvedValue({ success: true, data: [{ id: 'form-1', name: '申込用', isActive: true }] })
    const host = render()
    await act(async () => undefined)
    expect(host.textContent).toContain('個別導入診断、受付中です')
    const card = host.querySelector<HTMLButtonElement>('button[aria-current="true"]')!
    expect(card.closest('fieldset')!.disabled).toBe(false)
    expect(host.querySelector('input')!.closest('fieldset')!.disabled).toBe(true)
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="カード1の操作"]')!.disabled).toBe(true)
    for (const label of ['＋ CTAカードを足す', 'CTAカードを保存する', '申込フォームを保存する']) {
      expect([...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === label)!.disabled).toBe(true)
    }
    let save!: (() => Promise<boolean>) | null
    const registered = render({ registerSave: (handler) => { save = handler } })
    await act(async () => undefined)
    expect(save).toBeNull()
    expect(registered.textContent).toContain('閲覧のみ')
    expect(apiMocks.saveCtas).not.toHaveBeenCalled()
    expect(apiMocks.saveEditor).not.toHaveBeenCalled()
  })

  it('空のまま保存すると注意が出て送らない', async () => {
    const host = render()
    await act(async () => undefined)
    const add = [...host.querySelectorAll('button')].find((el) => el.textContent === '＋ CTAカードを足す')
    await act(async () => {
      add!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host.textContent).toContain('CTAカード 2枚')
    const save = [...host.querySelectorAll('button')].find((el) => el.textContent === 'CTAカードを保存する')
    await act(async () => {
      save!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(apiMocks.saveCtas).not.toHaveBeenCalled()
    expect(host.textContent).toContain('2枚目')
  })

  it('下の保存操作へ登録し、失敗では入力と未保存の印を残して再試行できる', async () => {
    let save: (() => Promise<boolean>) | null = null
    const dirty = vi.fn()
    const host = render({ registerSave: (callback) => { save = callback }, onDirtyChange: dirty })
    await act(async () => undefined)
    const title = host.querySelector('input') as HTMLInputElement
    await act(async () => fireEvent.change(title, { target: { value: '新しいCTA' } }))
    expect(dirty).toHaveBeenLastCalledWith(true)
    apiMocks.saveCtas.mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce({ data: [] })
    let result = true
    await act(async () => { result = await save!() })
    expect(result).toBe(false)
    expect(title.value).toBe('新しいCTA')
    expect(host.textContent).toContain('入力は残っています')
    expect(dirty).toHaveBeenLastCalledWith(true)
    await act(async () => { result = await save!() })
    expect(result).toBe(true)
    expect(dirty).toHaveBeenLastCalledWith(false)
    expect(apiMocks.saveCtas).toHaveBeenCalledTimes(2)
  })

  it('2枚とも埋めて保存すると2枚で送る', async () => {
    apiMocks.ctas.mockResolvedValue({
      data: [
        {
          atSeconds: 720,
          kind: 'form',
          title: '個別導入診断、受付中です',
          body: null,
          buttonLabel: '無料で診断を受ける',
          autoOpen: true,
          formId: 'form-1',
          url: null,
        },
        {
          atSeconds: 2700,
          kind: 'url',
          title: '資料をダウンロード',
          body: null,
          buttonLabel: '資料をもらう',
          autoOpen: false,
          formId: null,
          url: 'https://example.com/doc.pdf',
        },
      ],
    })
    const host = render()
    await act(async () => undefined)
    expect(host.textContent).toContain('CTAカード 2枚')
    const save = [...host.querySelectorAll('button')].find((el) => el.textContent === 'CTAカードを保存する')
    await act(async () => {
      save!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(apiMocks.saveCtas).toHaveBeenCalledTimes(1)
    const cards = apiMocks.saveCtas.mock.calls[0][1] as Array<{ atSeconds: number }>
    expect(cards).toHaveLength(2)
  })

  it('版の競合で入力を残し、最新版との比較と置き換えの確認を挟む', async () => {
    apiMocks.fetchApi.mockResolvedValue({ success: true, data: [{ id: 'form-1', name: 'この画面のフォーム', isActive: true }, { id: 'form-2', name: '保存済みのフォーム', isActive: true }] })
    apiMocks.saveEditor.mockRejectedValueOnce(new ApiError(409, 'version_conflict'))
    const latest = { ...EDITOR, version: 6, registrationFormId: 'form-2', publicPage: { form: { name: '保存済みのフォーム' } } } as WebinarEditor
    apiMocks.editor.mockResolvedValue({ data: latest })
    const changed = vi.fn()
    let save: (() => Promise<boolean>) | null = null
    const host = render({ onEditorChange: changed, registerSave: (callback) => { save = callback } })
    await act(async () => undefined)
    const selected = host.querySelector<HTMLButtonElement>('button[aria-label="申込に使う回答フォーム"]')!
    await act(async () => selected.click())
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"] button')].find((element) => element.textContent?.includes('この画面のフォーム'))!.click())
    const title = host.querySelector('input') as HTMLInputElement
    await act(async () => fireEvent.change(title, { target: { value: '入力を残すCTA' } }))
    const click = async (label: string) => act(async () => { [...host.querySelectorAll('button')].find((element) => element.textContent === label)!.click() })
    await click('申込フォームを保存する')
    expect(host.querySelector('[data-design-node="pvimJ"]')).not.toBeNull()
    expect(selected.textContent).toContain('この画面のフォーム')
    await act(async () => { expect(await save!()).toBe(false) })
    expect(apiMocks.saveCtas).not.toHaveBeenCalled()
    await click('違いを比べる')
    expect(host.textContent).toContain('保存されている申込フォーム：保存済みのフォーム')
    expect(host.textContent).toContain('この画面の入力：この画面のフォーム')
    expect(changed).not.toHaveBeenCalled()
    await click('最新を読み込んで続ける')
    expect(changed).not.toHaveBeenCalled()
    await act(async () => { [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((element) => element.textContent === '最新を読み込んで続ける')!.click() })
    expect(changed).toHaveBeenCalledWith(latest)
    expect(selected.textContent).toContain('保存済みのフォーム')
    expect(title.value).toBe('入力を残すCTA')
  })

})
