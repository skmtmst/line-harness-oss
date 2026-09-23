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

function byId(id: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const el = host.querySelector(`#${id}`)
  if (!el) throw new Error(`見つかりません: #${id}`)
  return el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
}

/** 「登録」の完全一致だけを拾う。部分一致だと秘密値警告側の
 *  「内容を確認して登録する」まで一緒に拾ってしまう。 */
function byExactText(tag: string, text: string): HTMLElement {
  const found = Array.from(host.querySelectorAll(tag)).find((el) => el.textContent?.trim() === text)
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
  it('有効期間と期間外の代替値を保存payloadへ渡す', async () => {
    await render()
    await setValue(byId('cv-name'), '期間限定案内')
    await setValue(byId('cv-key'), 'limited_notice')
    await setValue(byId('cv-value'), '受付中')
    await setValue(byId('cv-valid-from'), '2026-09-16T10:00')
    await setValue(byId('cv-valid-until'), '2026-09-16T12:00')
    await setValue(byId('cv-expiry-behavior'), 'fallback')
    await setValue(byId('cv-fallback-value'), '受付終了')
    await click(byExactText('button', '登録'))

    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({
      validFrom: '2026-09-16T10:00', validUntil: '2026-09-16T12:00',
      expiryBehavior: 'fallback', fallbackValue: '受付終了',
    }))
  })

  it('終了が開始と同時刻なら送信せず画面で止める', async () => {
    await render()
    await setValue(byId('cv-name'), '不正期間')
    await setValue(byId('cv-key'), 'invalid_window')
    await setValue(byId('cv-valid-from'), '2026-09-16T10:00')
    await setValue(byId('cv-valid-until'), '2026-09-16T10:00')
    await click(byExactText('button', '登録'))
    expect(api.create).not.toHaveBeenCalled()
    expect(host.textContent).toContain('有効終了は有効開始より後にしてください')
  })

  it.each([
    ['long_text', '案内'.repeat(5_000), 'TEXTAREA', null],
    ['date', '2028-02-29', 'INPUT', 'date'],
    ['datetime', '2028-02-29T23:59', 'INPUT', 'datetime-local'],
    ['boolean', 'true', 'SELECT', null],
  ])('%sを選ぶと適切な入力欄で保存payloadへ渡す', async (type, value, tagName, inputType) => {
    await render()
    await setValue(byId('cv-name'), `${type}の項目`)
    await setValue(byId('cv-key'), `${type}_value`)
    await click(host.querySelector(`input[name="cv-type"][value="${type}"]`) as HTMLInputElement)

    const control = byId('cv-value')
    expect(control.tagName).toBe(tagName)
    if (inputType) expect((control as HTMLInputElement).type).toBe(inputType)
    await setValue(control, value)
    await click(byExactText('button', '登録'))

    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ type, value }))
  })

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
 * VAR-06: 型別の入力エラーを「保存に失敗しました」で隠さない。
 * 空欄不可の種別は送信前に画面で止め、APIの400は理由をそのまま出して
 * 直す欄へ戻す。通信障害・重複・権限不足とは文を分ける。
 */
describe('共通情報の新規作成: 型別の入力エラー(VAR-06, 実React)', () => {
  it('真偽を選ばないままだと、理由を出して値の欄へ戻し送信しない', async () => {
    await render()
    await setValue(byId('cv-name'), '営業中フラグ')
    await setValue(byId('cv-key'), 'is_open')
    await click(host.querySelector('input[name="cv-type"][value="boolean"]') as HTMLInputElement)
    // 「選んでください」のまま登録する。
    await click(byExactText('button', '登録'))

    expect(api.create).not.toHaveBeenCalled()
    expect(host.textContent).toContain('値を選んでください')
    expect((document.activeElement as HTMLElement | null)?.id).toBe('cv-value')
  })

  it('年月日を空のまま登録すると、理由を出して送信しない', async () => {
    await render()
    await setValue(byId('cv-name'), '開店日')
    await setValue(byId('cv-key'), 'open_date')
    await click(host.querySelector('input[name="cv-type"][value="date"]') as HTMLInputElement)
    await click(byExactText('button', '登録'))

    expect(api.create).not.toHaveBeenCalled()
    expect(host.textContent).toContain('値の日付を入力してください')
  })

  it('画像に https URL でない文字列を入れると止める(VAR-03)', async () => {
    await render()
    await setValue(byId('cv-name'), 'ロゴ')
    await setValue(byId('cv-key'), 'logo_url')
    await click(host.querySelector('input[name="cv-type"][value="image"]') as HTMLInputElement)
    await setValue(byId('cv-value'), 'not-an-image')
    await click(byExactText('button', '登録'))

    expect(api.create).not.toHaveBeenCalled()
    expect(host.textContent).toContain('https://')
  })

  it('期間外の代替値が種別に合わないと止める', async () => {
    await render()
    await setValue(byId('cv-name'), 'ロゴ')
    await setValue(byId('cv-key'), 'logo_url2')
    await click(host.querySelector('input[name="cv-type"][value="image"]') as HTMLInputElement)
    await setValue(byId('cv-value'), 'https://cdn.example.com/logo.png')
    await setValue(byId('cv-expiry-behavior'), 'fallback')
    await setValue(byId('cv-fallback-value'), 'not-an-image')
    await click(byExactText('button', '登録'))

    expect(api.create).not.toHaveBeenCalled()
    expect(host.textContent).toContain('代替値は https:// からはじまるURLで入力してください')
    expect((document.activeElement as HTMLElement | null)?.id).toBe('cv-fallback-value')
  })

  it('APIの400は理由をそのまま出し、「保存に失敗しました」で隠さない', async () => {
    api.create.mockRejectedValue(new ApiError(400, '種別に合う値を入力してください'))
    await render()
    await setValue(byId('cv-name'), '営業時間')
    await setValue(byId('cv-key'), 'shop_hours')
    await setValue(byId('cv-value'), '10:00-18:00')
    await click(byExactText('button', '登録'))

    expect(host.textContent).toContain('種別に合う値を入力してください')
    expect(host.textContent).not.toContain('保存に失敗しました')
  })

  it('重複(409)は従来の案内を出し、差し込み名の欄へ戻す', async () => {
    api.create.mockRejectedValue(new ApiError(409, 'その差し込み名は既に使われています'))
    await render()
    await setValue(byId('cv-name'), '営業時間')
    await setValue(byId('cv-key'), 'shop_hours')
    await setValue(byId('cv-value'), '10:00-18:00')
    await click(byExactText('button', '登録'))

    expect(host.textContent).toContain('その差し込み名は既に使われています')
    expect((document.activeElement as HTMLElement | null)?.id).toBe('cv-key')
  })

  it('通信障害は入力エラーと混ぜず、通信の言葉で言う', async () => {
    api.create.mockRejectedValue(new TypeError('fetch failed'))
    await render()
    await setValue(byId('cv-name'), '営業時間')
    await setValue(byId('cv-key'), 'shop_hours')
    await setValue(byId('cv-value'), '10:00-18:00')
    await click(byExactText('button', '登録'))

    expect(host.textContent).toContain('通信が切れている可能性があります')
    // 入力は消さない。
    expect((byId('cv-value') as HTMLInputElement).value).toBe('10:00-18:00')
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
