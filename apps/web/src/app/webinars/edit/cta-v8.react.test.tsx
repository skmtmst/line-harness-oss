// @vitest-environment happy-dom
/*
 * ★V8 CTA・フォーム（`Q0Jrk`）の描画。
 * 差し替えるのは通信だけ。カードの一覧・選んだカードの欄・申込フォームが実在する。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
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
      ctas: apiMocks.ctas,
      saveCtas: apiMocks.saveCtas,
      saveEditor: apiMocks.saveEditor,
    },
  }
})

import CtaV8 from './cta-v8'
import type { WebinarEditor } from '@/lib/api'

const EDITOR = { version: 5, registrationFormId: null } as WebinarEditor

function render(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root: Root = createRoot(host)
  act(() => {
    root.render(
      <CtaV8
        webinarId="webinar-1"
        accountId="account-1"
        durationSeconds={3600}
        editor={EDITOR}
        onEditorChange={() => undefined}
      />,
    )
  })
  return host
}

describe('CTA・フォームのV8（Q0Jrk）', () => {
  beforeEach(() => {
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
})
