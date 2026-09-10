// @vitest-environment happy-dom
/*
 * 共通情報の新規作成画面を本物のReactで動かす試験(#687 差し戻し対応)。
 *
 * 文字列の有無を読む契約試験(page.test.ts)では、以下が実際にはすり抜けた:
 *   1. 秘密値注意の正規表現が `\b` に依存しており、`\b` は \w でない日本語の
 *      直前では成立しないため、「パスワード」「秘密鍵」「トークン」を含む
 *      社内メモが検知されないままPOSTへ進んでいた。
 *   2. 秘密値警告を出したままヘッダーでLINEアカウントを切り替えると、
 *      前アカウント向けの入力(社内メモ含む)が新アカウントへ登録された。
 *
 * ここは本物のReact(react-dom/client)・本物のDOMイベントで、通信
 * (api.commonVars.create)に渡った内容と画面に出る文字だけを見る。
 * Required PR gate の `pnpm --filter web test` で必ず実行される。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

/** アカウント切替を外から起こせるよう、選択中アカウントをmodule変数で持つ。 */
const fixture = vi.hoisted(() => ({ accountId: 'account-1' as string }))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId, loading: false }),
}))

import NewCommonVarPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

async function render() {
  await act(async () => { root.render(React.createElement(NewCommonVarPage)) })
}

function byId(id: string): HTMLInputElement | HTMLTextAreaElement {
  const el = host.querySelector(`#${id}`)
  if (!el) throw new Error(`見つかりません: #${id}`)
  return el as HTMLInputElement | HTMLTextAreaElement
}

/** 「登録」の完全一致だけを拾う。部分一致だと秘密値警告側の
 *  「内容を確認して登録する」まで一緒に拾ってしまう。 */
function byExactText(tag: string, text: string): HTMLElement {
  const found = Array.from(host.querySelectorAll(tag)).find((el) => el.textContent?.trim() === text)
  if (!found) throw new Error(`見つかりません: <${tag}> "${text}"`)
  return found as HTMLElement
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
  fixture.accountId = 'account-1'
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

describe('共通情報の新規作成(実React)', () => {
  it('日本語の秘密値ラベルを社内メモに書くと、送信前に警告して止める', async () => {
    await render()
    await setValue(byId('cv-name'), '営業時間')
    await setValue(byId('cv-key'), 'shop_hours')
    await setValue(byId('cv-memo'), 'パスワード: hunter2')
    await click(byExactText('button', '登録'))

    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(host.textContent).toContain('社内メモ')
    expect(api.create).not.toHaveBeenCalled()
  })

  it('警告表示中にアカウントを切り替えると、前アカウントの入力は別アカウントへ登録されない', async () => {
    await render()
    await setValue(byId('cv-name'), 'account-1の下書き')
    await setValue(byId('cv-key'), 'draft_key')
    await setValue(byId('cv-memo'), 'password: hunter2')
    await click(byExactText('button', '登録'))
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull()

    // ヘッダーのアカウント選択(ページ遷移なし)で account-2 へ切り替える。
    fixture.accountId = 'account-2'
    await render()

    // 切替後は前アカウント向けの警告・入力を引き継がない。
    expect(host.querySelector('[role="alertdialog"]')).toBeNull()
    expect((byId('cv-name') as HTMLInputElement).value).toBe('')
    expect((byId('cv-memo') as HTMLTextAreaElement).value).toBe('')
    expect(host.textContent).toContain('LINEアカウントが切り替わったため、入力をやり直してください')

    // account-2 用に改めて入力し、account-2 として正しく登録できる。
    await setValue(byId('cv-name'), 'account-2の値')
    await setValue(byId('cv-key'), 'a2_key')
    await click(byExactText('button', '登録'))

    expect(api.create).toHaveBeenCalledTimes(1)
    expect(api.create.mock.calls[0][0]).toMatchObject({ accountId: 'account-2', name: 'account-2の値' })
    // account-1 で入力していた秘密値らしい社内メモは、どのアカウントへも送信されない。
    expect(api.create.mock.calls.some((call) => call[0].memo === 'password: hunter2')).toBe(false)
  })
})

/*
 * #687 再差し戻し: 「パスワード・秘密鍵・トークン」の3語限定かつ
 * `[=:：]` の区切り記号必須という設計のため、それ以外のよくある表記
 * ("APIキー"などの語彙違い、区切り記号なしの自然な日本語)を素通りして
 * いた。司令塔の独立審査が実際に node で確かめた未検知6例と、
 * 引き続き誤検知してはいけない通常文を、実mountで両方とも試験する。
 */
describe('日本語の秘密値検知(限定語彙+区切り記号必須という設計そのものの見直し)', () => {
  const shouldWarn: Array<[memo: string, note: string]> = [
    ['APIキー: sk-abcdefghij', '語彙: パスワード・秘密鍵・トークン以外のラベル'],
    ['合言葉: sesame1234', '語彙: パスワード・秘密鍵・トークン以外のラベル'],
    ['シークレット: abcdefgh', '語彙: パスワード・秘密鍵・トークン以外のラベル'],
    ['暗証番号: 123456', '語彙: パスワード・秘密鍵・トークン以外のラベル'],
    ['アカウントのパスワードはhunter2です', '書式: 区切り記号なしの自然文(助詞「は」)'],
    ['パスワード hunter2', '書式: 半角スペース区切り(区切り記号なし)'],
  ]

  it.each(shouldWarn)('検知する: "%s"(%s)', async (memo) => {
    await render()
    await setValue(byId('cv-name'), '営業時間')
    await setValue(byId('cv-key'), 'shop_hours')
    await setValue(byId('cv-memo'), memo)
    await click(byExactText('button', '登録'))

    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(api.create).not.toHaveBeenCalled()
  })

  const shouldNotWarn: Array<[memo: string, note: string]> = [
    ['パスワードの使い方を説明します', '既知の通常文(値を伴わない説明)'],
    ['パスワードが分かりません', '助詞「が」の通常文(値が続かない)'],
    ['暗証番号を忘れた場合はサポートへ連絡してください', '助詞「を」の通常文'],
    ['トークンの発行方法について説明します', 'ラベル語彙を含むが値を伴わない説明文'],
    ['営業時間は10:00〜18:00です', 'ラベル語彙自体を含まない通常文'],
  ]

  it.each(shouldNotWarn)('誤検知しない: "%s"(%s)', async (memo) => {
    await render()
    await setValue(byId('cv-name'), '営業時間')
    await setValue(byId('cv-key'), 'shop_hours2')
    await setValue(byId('cv-memo'), memo)
    await click(byExactText('button', '登録'))

    // 誤検知していなければ、警告を出さずにそのまま送信まで進む。
    expect(host.querySelector('[role="alertdialog"]')).toBeNull()
    expect(api.create).toHaveBeenCalledTimes(1)
    expect(api.create.mock.calls[0][0]).toMatchObject({ memo })
  })
})
