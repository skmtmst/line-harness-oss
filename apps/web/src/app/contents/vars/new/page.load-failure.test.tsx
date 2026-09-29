// @vitest-environment happy-dom
/*
 * 共通情報の新規登録画面：フォルダ取得の失敗と真偽値の入力エラー試験
 * （監査R593・R594、実React）。
 *
 * R593: 以前はフォルダGETの失敗を黙って握りつぶしていたため、503でも
 * 正常な0件と同じ「未分類だけ」になり、失敗と再試行が出なかった。
 * ここでは失敗の明示・再試行・未分類のまま登録できること、直ると
 * 既存フォルダを選べることを見る。
 *
 * R594: 真偽値を空欄で登録したときの入力エラーが、true/falseを選んだ
 * あとも画面下部に残っていた。欄直下と画面下部の両方が選択後に消える
 * ことを見る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'

const api = vi.hoisted(() => ({
  create: vi.fn(),
  foldersList: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      commonVars: { ...actual.api.commonVars, create: api.create },
      folders: { ...actual.api.folders, list: api.foldersList },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1', loading: false }),
}))

vi.mock('@/components/shared/select', () => ({
  default: ({ 'aria-label': label, id, value, onChange, options }: {
    'aria-label'?: string
    id?: string
    value: string
    onChange: (value: string) => void
    options: Array<{ value: string; label: string }>
  }) => React.createElement(
    'select',
    { 'aria-label': label, id, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
    options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)),
  ),
}))

import NewCommonVarPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

async function render() {
  await act(async () => { root.render(React.createElement(NewCommonVarPage)) })
}

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
}

function byId(id: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const el = document.querySelector(`#${id}`)
  if (!el) throw new Error(`見つかりません: #${id}`)
  return el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
}

/** 「登録」の完全一致だけを拾う。部分一致だと秘密値警告側の
 *  「内容を確認して登録する」まで一緒に拾ってしまう。 */
function byExactText(tag: string, text: string): HTMLElement {
  const found = Array.from(document.querySelectorAll(tag)).find((el) => el.textContent?.trim() === text)
  if (!found) throw new Error(`見つかりません: <${tag}> "${text}"`)
  return found as HTMLElement
}

async function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  await act(async () => {
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    if (element instanceof HTMLSelectElement) element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}

beforeEach(() => {
  vi.clearAllMocks()
  api.foldersList.mockResolvedValue({ success: true, data: [] })
  api.create.mockResolvedValue({ success: true, data: { id: 'var-1' } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.restoreAllMocks()
})

describe('共通情報の新規登録：フォルダ取得の失敗と真偽値の入力エラー(R593・R594, 実React)', () => {
  it('R593: フォルダ503では失敗と再試行を出し、未分類のまま登録できる', async () => {
    api.foldersList.mockRejectedValue(new ApiError(503, 'Service Unavailable'))
    await render()
    await settle()

    // 失敗の明示と再試行。0件（未分類だけ）と見分けが付く。
    const block = document.querySelector('[data-folders-state="error"]')
    expect(block?.textContent).toContain('フォルダ')
    expect(block?.textContent).toContain('未分類')
    expect(block?.textContent).toContain('再読み込み')
    // フォルダ欄自体は未分類で残り、登録へ進める。
    expect(byId('cv-folder').textContent).toContain('未分類')

    await setValue(byId('cv-name'), '営業時間')
    await setValue(byId('cv-key'), 'shop_hours')
    await setValue(byId('cv-value'), '受付中')
    await click(byExactText('button', '登録'))
    await settle()

    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ folderId: null }))
  })

  it('R593: フォルダの再試行で直ると失敗表示が消え、既存フォルダを選べる', async () => {
    api.foldersList.mockRejectedValueOnce(new ApiError(503, 'Service Unavailable'))
    api.foldersList.mockResolvedValue({ success: true, data: [{ id: 'f-1', name: '案内' }] })
    await render()
    await settle()
    expect(document.querySelector('[data-folders-state="error"]')).not.toBeNull()

    const block = document.querySelector('[data-folders-state="error"]')!
    const button = Array.from(block.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '再読み込み',
    )!
    await click(button as HTMLElement)
    await settle()

    expect(document.querySelector('[data-folders-state="error"]')).toBeNull()
    expect(byId('cv-folder').textContent).toContain('案内')
  })

  it('R593: 通常200では既存フォルダを選べる（後退防止）', async () => {
    api.foldersList.mockResolvedValue({ success: true, data: [{ id: 'f-1', name: '案内' }] })
    await render()
    await settle()

    expect(document.querySelector('[data-folders-state="error"]')).toBeNull()
    await setValue(byId('cv-folder'), 'f-1')
    await setValue(byId('cv-name'), '営業時間')
    await setValue(byId('cv-key'), 'shop_hours')
    await setValue(byId('cv-value'), '受付中')
    await click(byExactText('button', '登録'))
    await settle()

    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'f-1' }))
  })

  it('R594: 真偽値を空欄で登録したエラーは、trueを選ぶと欄直下・画面下部の両方から消える', async () => {
    await render()
    await settle()
    await setValue(byId('cv-name'), '受付可否')
    await setValue(byId('cv-key'), 'is_open')
    await click(document.querySelector('input[name="cv-type"][value="boolean"]') as HTMLInputElement)

    // 空欄のまま登録すると入力エラーが欄直下と画面下部の両方に出る。
    await click(byExactText('button', '登録'))
    await settle()
    expect(api.create).not.toHaveBeenCalled()
    const fieldError = document.querySelector('#cv-value')?.parentElement?.textContent ?? ''
    expect(fieldError).toContain('値を選んでください')
    const alerts = Array.from(document.querySelectorAll('[role="alert"]')).map((el) => el.textContent ?? '')
    expect(alerts.some((text) => text.includes('値を選んでください'))).toBe(true)

    // trueを選ぶと両方消える。
    await setValue(byId('cv-value'), 'true')
    await settle()
    const fieldErrorAfter = document.querySelector('#cv-value')?.parentElement?.textContent ?? ''
    expect(fieldErrorAfter).not.toContain('値を選んでください')
    expect(document.querySelectorAll('[role="alert"]').length).toBe(0)

    // そのまま登録できる。
    await click(byExactText('button', '登録'))
    await settle()
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'boolean', value: 'true' }))
  })
})
