// @vitest-environment happy-dom
/*
 * 「保存した社内メモは、編集画面を開き直すと再表示される」を本物の
 * React(react-dom/client)で確かめる試験(#687 再差し戻し(2))。
 *
 * これまで `page.interaction.spec.ts`(Playwright)にしか無く、Required PR
 * gateの `pnpm --filter web test`(vitest)からは呼ばれていなかった。
 * `apps/web/src/app/contents/vars/edit/` 配下にも試験が1つも無かった。
 * ここでは新規作成画面(`../new/page`)を実mountして社内メモを保存し、
 * 実際にAPIへ渡った内容を編集画面(`./page`)の詳細取得へそのまま返して、
 * 編集画面の社内メモ欄に同じ値が出ることを見る。
 * `.test.tsx` は `vitest.config.ts` の include に入るため、Required gate
 * で必ず実行される。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  create: vi.fn(),
  foldersList: vi.fn(),
  detail: vi.fn(),
  schedules: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      commonVars: {
        ...actual.api.commonVars,
        create: api.create,
        detail: api.detail,
        schedules: api.schedules,
      },
      folders: { ...actual.api.folders, list: api.foldersList },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

const navigation = vi.hoisted(() => ({ query: 'id=var-1' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1', loading: false }),
}))

import NewCommonVarPage from '../new/page'
import EditCommonVarPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

async function mount(element: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(element) })
}

async function unmount() {
  await act(async () => { root.unmount() })
  host.remove()
}

/** 効果(Promise.all([detail, folders, schedules]))が落ち着くまで進める。 */
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
}

function byId(id: string): HTMLInputElement | HTMLTextAreaElement {
  const el = host.querySelector(`#${id}`)
  if (!el) throw new Error(`見つかりません: #${id}`)
  return el as HTMLInputElement | HTMLTextAreaElement
}

function byExactText(tag: string, text: string): HTMLElement {
  const found = Array.from(host.querySelectorAll(tag)).find((el) => el.textContent?.trim() === text)
  if (!found) throw new Error(`見つかりません: <${tag}> "${text}"`)
  return found as HTMLElement
}

/** 編集画面の社内メモ欄。id/aria-labelを持たないためplaceholderで探す。 */
function memoInput(): HTMLInputElement {
  const found = Array.from(host.querySelectorAll('input')).find(
    (el) => el.getAttribute('placeholder') === '運用上の注意や、この値の使い方を書きます',
  )
  if (!found) throw new Error('編集画面の社内メモ欄が見つかりません')
  return found as HTMLInputElement
}

async function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  await act(async () => {
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}

beforeEach(() => {
  vi.clearAllMocks()
  navigation.query = 'id=var-1'
  api.foldersList.mockResolvedValue({ success: true, data: [] })
  api.create.mockResolvedValue({ success: true, data: { id: 'var-1' } })
  api.schedules.mockResolvedValue({ success: true, data: [] })
})

afterEach(async () => {
  if (root) await unmount()
  vi.restoreAllMocks()
})

describe('共通情報: 保存した社内メモの再表示(実React)', () => {
  it('新規作成で保存した社内メモが、編集画面を開き直すと同じ内容で表示される', async () => {
    // 1. 新規作成画面で社内メモを含めて保存する。
    await mount(React.createElement(NewCommonVarPage))
    await setValue(byId('cv-name'), '再表示確認用')
    await setValue(byId('cv-key'), 'redisplay_check')
    await setValue(byId('cv-value'), '平日 10:00〜18:00')
    await setValue(byId('cv-memo'), '更新は毎月1日に確認する')
    await click(byExactText('button', '登録'))

    expect(api.create).toHaveBeenCalledTimes(1)
    const created = api.create.mock.calls[0][0]
    expect(created.memo).toBe('更新は毎月1日に確認する')
    await unmount()

    // 2. 実際にAPIへ渡った内容を、詳細取得の応答としてそのまま返す
    //    (契約試験のように固定文字列を2回書かない)。
    api.detail.mockResolvedValue({
      success: true,
      data: {
        id: 'var-1',
        name: created.name,
        varKey: created.varKey,
        type: created.type,
        value: created.value,
        memo: created.memo,
        folderId: null,
        version: 1,
        history: [],
      },
    })

    // 3. 編集画面を開き直す。
    await mount(React.createElement(EditCommonVarPage))
    await settle()

    expect(memoInput().value).toBe(created.memo)
  })
})
