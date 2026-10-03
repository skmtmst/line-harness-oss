// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

/*
 * ★V8-B ウェビナー③CTAの競合（板 `pvimJ` の保存側）の契約。
 * 他の人が先に保存したとき（409）は、親の器へ競合を報告する。
 * 報告を受けた器は帯を出して、最新を読み込んでから続ける。
 */
vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))

const apiMocks = vi.hoisted(() => {
  class MockApiError extends Error {
    status: number
    code: string | undefined
    constructor(status: number, code?: string) {
      super(`api_${status}`)
      this.status = status
      this.code = code
    }
  }
  return {
    ApiError: MockApiError,
    ctas: vi.fn(),
    saveCtas: vi.fn(),
    saveEditor: vi.fn(),
    forms: vi.fn(),
  }
})

vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return {
    ...actual,
    ApiError: apiMocks.ApiError,
    fetchApi: apiMocks.forms,
    webinarApi: {
      ctas: apiMocks.ctas,
      saveCtas: apiMocks.saveCtas,
      saveEditor: apiMocks.saveEditor,
    },
  }
})

import CtaStepV8 from './cta-v8'

let root: Root
let host: HTMLDivElement

const webinar = {
  id: 'webinar-1',
  durationSeconds: 3600,
  accountId: 'account-a',
}

const editor = {
  version: 3,
  registrationFormId: null,
  publicPage: { form: null },
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  apiMocks.ctas.mockResolvedValue({
    data: [{
      atSeconds: 720, kind: 'url', title: '個別導入診断、受付中です', body: null,
      buttonLabel: '無料で診断を受ける', autoOpen: false, formId: null, url: 'https://example.com/form',
    }],
  })
  apiMocks.forms.mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  vi.clearAllMocks()
})

test('保存で409が返ったら競合を報告する', async () => {
  apiMocks.saveCtas.mockRejectedValue(new apiMocks.ApiError(409, 'version_conflict'))
  let saved: (() => Promise<boolean>) | null = null
  const onConflict = vi.fn()
  await act(async () => {
    root.render(
      <CtaStepV8
        webinar={webinar as never}
        editor={editor as never}
        accountId="account-a"
        onEditorChange={() => {}}
        onDirtyChange={() => {}}
        registerSave={(save) => { saved = save }}
        onConflict={onConflict}
      />,
    )
  })
  await act(async () => {})
  /* 時刻を変えて下書きを作る（検証を通る値のまま）。 */
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  const timeInput = [...host.querySelectorAll('input')].find((input) => input.placeholder === '12:00')
  expect(timeInput).not.toBeUndefined()
  await act(async () => {
    if (timeInput) {
      setter.call(timeInput, '12:01')
      timeInput.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })
  expect(saved).not.toBeNull()
  let ok = true
  await act(async () => {
    ok = await saved?.()
  })
  expect(ok).toBe(false)
  expect(onConflict).toHaveBeenCalledTimes(1)
})
