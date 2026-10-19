import { pickEntity } from '@/components/shared/entity-picker-test-helpers'
// @vitest-environment happy-dom
/*
 * ★V8 CTA・フォーム（）の描画。
 * 差し替えるのは通信だけ。カードの一覧・選んだカードの欄・申込フォームが実在する。
 */
import { fireEvent, screen, within } from '@testing-library/react'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  editor: vi.fn(),
  ctas: vi.fn(),
  saveCtas: vi.fn(),
  saveEditor: vi.fn(),
  fetchApi: vi.fn(),
}))

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

import CtaPane from '@/v8/webinar-edit/cta'
import { webinarEditContext, webinarWizardChrome } from '@/test-utils/webinar-edit'
import type { EditContext, PaneSaveProps } from '@/v8/webinar-edit/types'
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
import { ApiError, type Webinar, type WebinarEditor } from '@/lib/api'

const EDITOR = { version: 5, registrationFormId: null, publicPage: { form: null } } as WebinarEditor

const roots: Root[] = []
function render(props: Partial<PaneSaveProps & Pick<EditContext, 'onEditorChange'>> = {}): HTMLElement {
  let saveHandler: (() => Promise<boolean>) | null = null
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root: Root = createRoot(host)
  roots.push(root)
  act(() => {
    root.render(
      <CtaPane
        ctx={webinarEditContext({ id: 'webinar-1', accountId: 'account-1', durationSeconds: 3600 } as Webinar, EDITOR, { onEditorChange: props.onEditorChange ?? (() => {}) })}
        chrome={{ ...webinarWizardChrome, footerActions: <button onClick={() => void saveHandler?.()}>下書きを保存</button> }}
        onDirtyChange={props.onDirtyChange ?? (() => {})}
        registerSave={(handler) => { saveHandler = handler; props.registerSave?.(handler) }}
      />,
    )
  })
  return host
}

describe('CTA・フォームのV8（Q0Jrk）', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    apiMocks.saveCtas.mockResolvedValue({ data: [] })
    apiMocks.saveEditor.mockResolvedValue({ data: { ...EDITOR, version: 6 } })
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
    apiMocks.fetchApi.mockResolvedValue({ success: true, data: [{ id: 'form-1', name: 'フォーム1', isActive: true }] })
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
    expect(host.textContent).toContain('CTA カード 1 枚')
    expect(host.textContent).toContain('個別導入診断、受付中です')
    expect(host.textContent).toContain('申込に使う回答フォーム')
    expect(host.textContent).toContain('カードの見え方')
  })

  it('空のまま保存すると注意が出て送らない', async () => {
    const host = render()
    await act(async () => undefined)
    await pickEntity('申込に使う回答フォーム', 'フォーム1')
    const add = [...host.querySelectorAll('button')].find((el) => el.textContent === 'CTA カードを足す')
    await act(async () => {
      add!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host.textContent).toContain('CTA カード 2 枚')
    const save = [...host.querySelectorAll('button')].find((el) => el.textContent === '下書きを保存')
    await act(async () => {
      save!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(apiMocks.saveCtas).not.toHaveBeenCalled()
    expect(apiMocks.saveEditor).not.toHaveBeenCalled()
    expect(host.textContent).toContain('カード2')
  })

  it('下の保存操作へ登録し、失敗では入力と未保存の印を残して再試行できる', async () => {
    let save: (() => Promise<boolean>) | null = null
    const dirty = vi.fn()
    const host = render({ registerSave: (callback) => { save = callback }, onDirtyChange: dirty })
    await act(async () => undefined)
    const title = host.querySelector('#cta-title') as HTMLInputElement
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
    expect(host.textContent).toContain('CTA カード 2 枚')
    const save = [...host.querySelectorAll('button')].find((el) => el.textContent === '下書きを保存')
    await act(async () => {
      save!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(apiMocks.saveCtas).toHaveBeenCalledTimes(1)
    const cards = apiMocks.saveCtas.mock.calls[0][1] as Array<{ atSeconds: number }>
    expect(cards).toHaveLength(2)
  })

  it('秒数だけで出す時刻を入れても保存する値は秒で送る', async () => {
    let save: (() => Promise<boolean>) | null = null
    const host = render({ registerSave: (handler) => { save = handler } })
    await act(async () => undefined)
    fireEvent.change(host.querySelector('#cta-time')!, { target: { value: '600' } })
    await act(async () => { expect(await save!()).toBe(true) })
    expect(apiMocks.saveCtas).toHaveBeenCalledWith('webinar-1', [expect.objectContaining({ atSeconds: 600 })])
  })

  it('申込フォームだけ保存できた後は、カード失敗の再試行でフォームを二度保存しない', async () => {
    apiMocks.saveCtas.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ data: [] })
    let save: (() => Promise<boolean>) | null = null
    const host = render({ registerSave: (handler) => { save = handler } })
    await act(async () => undefined)
    await pickEntity('申込に使う回答フォーム', 'フォーム1')
    fireEvent.change(host.querySelector('#cta-title')!, { target: { value: '保存したいCTA' } })
    await act(async () => { expect(await save!()).toBe(false) })
    expect(apiMocks.saveEditor.mock.invocationCallOrder[0]).toBeLessThan(apiMocks.saveCtas.mock.invocationCallOrder[0])
    expect(apiMocks.saveEditor).toHaveBeenCalledTimes(1)
    expect((host.querySelector('#cta-title') as HTMLInputElement).value).toBe('保存したいCTA')
    await act(async () => { expect(await save!()).toBe(true) })
    expect(apiMocks.saveEditor).toHaveBeenCalledTimes(1)
    expect(apiMocks.saveCtas).toHaveBeenCalledTimes(2)
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
    await pickEntity('申込に使う回答フォーム', 'この画面のフォーム')
    const title = host.querySelector('#cta-title') as HTMLInputElement
    await act(async () => fireEvent.change(title, { target: { value: '入力を残すCTA' } }))
    const click = async (label: string) => act(async () => { [...host.querySelectorAll('button')].find((element) => element.textContent === label)!.click() })
    await click('下書きを保存')
    expect(host.querySelector('[data-design-node="pvimJ"]')).not.toBeNull()
    expect(host.querySelector('button[aria-label^="申込に使う回答フォーム"]')?.parentElement?.textContent).toContain('この画面のフォーム')
    expect(save).toBeNull()
    expect(apiMocks.saveCtas).not.toHaveBeenCalled()
    await click('違いを比べる')
    const comparison = screen.getByRole('dialog', { name: '違いを比べる' })
    expect(within(comparison).getByRole('cell', { name: '保存済みのフォーム' })).toBeTruthy()
    expect(within(comparison).getByRole('cell', { name: 'この画面のフォーム' })).toBeTruthy()
    expect(changed).not.toHaveBeenCalled()
    await click('最新を読み込んで続ける')
    expect(changed).not.toHaveBeenCalled()
    const confirm = screen.getByRole('dialog', { name: '最新を読み込んで続けますか？' })
    expect(within(confirm).getByText(/CTA カードの入力は残します/)).toBeTruthy()
    await act(async () => { within(confirm).getByRole('button', { name: '最新を読み込んで続ける' }).click() })
    expect(changed).toHaveBeenCalledWith(latest)
    expect(host.querySelector('button[aria-label^="申込に使う回答フォーム"]')?.parentElement?.textContent).toContain('保存済みのフォーム')
    expect(title.value).toBe('入力を残すCTA')
  })

})
