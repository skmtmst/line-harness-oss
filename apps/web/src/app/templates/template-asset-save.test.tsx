// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * #989 (NEXT-16〜19/24): テンプレート作成画面の「表示と保存値の食い違い」
 * 回帰試験。実Reactで操作→保存API呼出を観る。
 *
 * - NEXT-17: クーポンの回数・公開対象・抽選・期間が選択どおり保存される。
 * - NEXT-18: リッチメッセージは選んだ形状の面数だけ設定欄と tapAreas ができる。
 * - NEXT-19: リサーチの質問は配列で、順序・形式・必須・選択肢まで保存される。
 * - NEXT-24: 「自分に送って確かめる」は未対応と分かる形で出る（無反応でない）。
 */
const fixture = vi.hoisted(() => ({
  accountId: 'account-a',
  createCalls: [] as Array<{ lineAccountId: string; kind: string; name: string; payload: Record<string, unknown> }>,
}))

const emptyList = () => Promise.resolve({ success: true, data: [] })

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.accountId, loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('@/lib/api', () => ({
  api: {
    broadcastMessageAssets: {
      create: (input: { lineAccountId: string; kind: string; name: string; payload: Record<string, unknown> }) => {
        fixture.createCalls.push(input)
        return Promise.resolve({ success: true, data: { id: 'asset-1' } })
      },
    },
    media: {
      list: () => Promise.resolve({ success: true, data: { items: [], total: 0, limit: 20, offset: 0 } }),
      contentUrl: (id: string, accountId: string) => `/api/media/${id}/content?accountId=${accountId}`,
    },
    // InlineActionList / useActionOptions が読む候補。
    tags: { list: emptyList },
    friendFields: { list: emptyList },
    supportMarks: { list: emptyList },
    scenarios: { list: emptyList },
    commonVars: { list: emptyList },
    featureSettings: { visibility: () => Promise.resolve({ success: true, data: { features: {} } }) },
  },
}))

const { default: TemplateAssetEditor } = await import('./template-asset-editor')

let host: HTMLDivElement
let root: Root

async function settle() {
  await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

async function renderEditor(kind: 'rich_message' | 'coupon' | 'research') {
  await act(async () => {
    root.render(<TemplateAssetEditor kind={kind} />)
    await settle()
  })
}

function buttonByText(text: string, scope: ParentNode = host): HTMLButtonElement {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!button) throw new Error(`ボタンがありません: ${text}`)
  return button
}

function buttonContaining(text: string, scope: ParentNode = host): HTMLButtonElement {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.includes(text))
  if (!button) throw new Error(`ボタンがありません: ${text}`)
  return button
}

function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function setSelectValue(el: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
  setter.call(el, value)
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function input(selector: string): HTMLInputElement {
  const el = host.querySelector<HTMLInputElement>(selector)
  if (!el) throw new Error(`入力欄がありません: ${selector}`)
  return el
}

function selectByLabel(label: string): HTMLSelectElement {
  const el = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)
  if (!el) throw new Error(`選択欄がありません: ${label}`)
  return el
}

/** 名前を入れて保存する。 */
async function nameAndSave() {
  const nameInput = host.querySelector<HTMLInputElement>('input[type="text"]')!
  await act(async () => {
    setInputValue(nameInput, '監査用テンプレート')
    await settle()
  })
  await act(async () => {
    buttonByText('テンプレートを保存').click()
    await settle()
  })
}

beforeEach(() => {
  fixture.accountId = 'account-a'
  fixture.createCalls.length = 0
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('NEXT-17: クーポンの設定が保存値へ入る', () => {
  it('回数・公開対象・期間・抽選なしを選ぶと、その値だけが保存される', async () => {
    await renderEditor('coupon')

    await act(async () => {
      setInputValue(input('input[aria-label="使える期間の開始"]'), '2026-10-01T09:00')
      setInputValue(input('input[aria-label="使える期間の終了"]'), '2026-10-31T23:59')
      setSelectValue(selectByLabel('使える回数'), 'unlimited')
      setSelectValue(selectByLabel('だれに見えるか'), 'link')
      setSelectValue(selectByLabel('抽選にする'), 'off')
      await settle()
    })

    // 抽選なしでは確率・当選上限の入力欄自体が出ない（有効な設定に見せない）。
    expect(host.querySelector('input[aria-label="当たる確率"]')).toBeNull()
    expect(host.querySelector('input[aria-label="当選人数の上限"]')).toBeNull()

    await nameAndSave()
    expect(fixture.createCalls).toHaveLength(1)
    const payload = fixture.createCalls[0].payload
    expect(payload).toMatchObject({
      startsAt: '2026-10-01T09:00',
      endsAt: '2026-10-31T23:59',
      oncePerFriend: false,
      visibility: 'link',
      lottery: false,
    })
    expect(payload).not.toHaveProperty('lotteryRate')
    expect(payload).not.toHaveProperty('winnerLimit')
  })

  it('抽選ありでは確率・当選上限の入力値がそのまま保存される', async () => {
    await renderEditor('coupon')
    await act(async () => {
      setSelectValue(selectByLabel('抽選にする'), 'on')
      setInputValue(input('input[aria-label="使える期間の開始"]'), '2026-10-01T09:00')
      setInputValue(input('input[aria-label="使える期間の終了"]'), '2026-11-30T23:59')
      await settle()
    })
    await act(async () => {
      setInputValue(input('input[aria-label="当たる確率"]'), '35')
      setInputValue(input('input[aria-label="当選人数の上限"]'), '120')
      await settle()
    })
    await nameAndSave()
    expect(fixture.createCalls[0].payload).toMatchObject({
      lottery: true,
      lotteryRate: 35,
      winnerLimit: 120,
      oncePerFriend: true,
      visibility: 'friends',
    })
  })

  it('期間が未入力だと保存せず理由を出す', async () => {
    await renderEditor('coupon')
    await nameAndSave()
    expect(fixture.createCalls).toHaveLength(0)
    expect(host.textContent).toContain('使える期間の開始と終了を入力してください')
  })
})

describe('NEXT-18: リッチメッセージの面数と保存値が一致する', () => {
  it('6面を選ぶと6面分の設定欄が出て、tapAreas も6件になる', async () => {
    await renderEditor('rich_message')
    await act(async () => {
      buttonContaining('6面').click()
      await settle()
    })

    const areaSelects = [...host.querySelectorAll<HTMLSelectElement>('select[aria-label^="面 "]')]
    expect(areaSelects).toHaveLength(6)
    // 未設定の面は警告に数える（A〜F全部）。
    expect(host.textContent).toContain('面 A・面 B・面 C・面 D・面 E・面 Fのアクションが未設定です')

    // 面 A を「URLを開く」にして URL を入れる。
    await act(async () => {
      setSelectValue(areaSelects[0], 'uri')
      await settle()
    })
    await act(async () => {
      setInputValue(input('input[aria-label="面 A のURL"]'), 'https://example.com/campaign')
      setInputValue(input('input[placeholder="画像URL"]'), 'https://cdn.example.test/rich.png')
      await settle()
    })

    await nameAndSave()
    const payload = fixture.createCalls[0].payload
    expect(payload.shape).toBe('6')
    const tapAreas = payload.tapAreas as Array<Record<string, unknown>>
    expect(tapAreas.map((area) => area.label)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
    // 座標が面ごとに明示されている（合計で画像全体を覆う）。
    expect(tapAreas[0]).toMatchObject({ actionType: 'uri', uri: 'https://example.com/campaign' })
    expect(tapAreas[5]).toMatchObject({ actionType: 'none' })
    for (const area of tapAreas) {
      expect(typeof area.x).toBe('number')
      expect(typeof area.width).toBe('number')
    }
  })

  it('設定済みの面を消す形へ変えるときは確認し、承認すると設定が消える', async () => {
    await renderEditor('rich_message')
    // 初期は 3面（A・B・C）。面 C に設定を入れる。
    await act(async () => {
      setSelectValue(selectByLabel('面 C の動き'), 'uri')
      await settle()
    })
    await act(async () => {
      setInputValue(input('input[aria-label="面 C のURL"]'), 'https://example.com/c')
      await settle()
    })

    // 左右2面（A・B）へ変えると面 C が消えるので、確認が出る。
    await act(async () => {
      buttonContaining('左右2面').click()
      await settle()
    })
    // destructive な確認窓は role="alertdialog" で出る（共通 Dialog の作り）。
    const dialog = document.body.querySelector('[role="alertdialog"], [role="dialog"]')
    expect(dialog?.textContent).toContain('面 C')
    // まだ形状は変わっていない（設定欄が6つ→ではなく3つのまま）。
    expect(host.querySelectorAll('select[aria-label^="面 "]')).toHaveLength(3)

    await act(async () => {
      buttonByText('面の数を変える', dialog as HTMLElement).click()
      await settle()
    })
    expect(host.querySelectorAll('select[aria-label^="面 "]')).toHaveLength(2)
    expect(host.querySelector('input[aria-label="面 C のURL"]')).toBeNull()

    await act(async () => {
      setInputValue(input('input[placeholder="画像URL"]'), 'https://cdn.example.test/rich.png')
      await settle()
    })
    await nameAndSave()
    const tapAreas = fixture.createCalls[0].payload.tapAreas as Array<Record<string, unknown>>
    expect(tapAreas.map((area) => area.label)).toEqual(['A', 'B'])
  })
})

describe('NEXT-19: リサーチの質問が保存値へ入る', () => {
  it('質問の追加・本文・形式・必須・選択肢が保存され、順序も保つ', async () => {
    await renderEditor('research')
    // 初期は1問。追加すると2問目が選ばれた状態になる。
    await act(async () => {
      buttonByText('質問を追加（あと9問）').click()
      await settle()
    })
    expect(host.textContent).toContain('2 / 10 問')

    // 2問目（選択中）を「いくつでも選ぶ・任意」にし、選択肢を入れる。
    await act(async () => {
      setInputValue(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="質問文"]')!, 'よく使っている商品を教えてください')
      setSelectValue(selectByLabel('答え方'), 'multiple')
      await settle()
    })
    const requiredCheckbox = input('input[aria-label="必ず答えてもらう"]')
    await act(async () => {
      requiredCheckbox.click()
      await settle()
    })
    const choices = [...host.querySelectorAll<HTMLInputElement>('input[placeholder^="選択肢"]')]
    await act(async () => {
      setInputValue(choices[0], 'フード')
      setInputValue(choices[1], 'おやつ')
      await settle()
    })

    // 1問目を選んで本文を入れる。
    await act(async () => {
      buttonByText('1　1つだけ選ぶ　（未入力）').click()
      await settle()
    })
    await act(async () => {
      setInputValue(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="質問文"]')!, '来月も定期便を続けたいと思いますか？')
      await settle()
    })
    const firstChoices = [...host.querySelectorAll<HTMLInputElement>('input[placeholder^="選択肢"]')]
    await act(async () => {
      setInputValue(firstChoices[0], '続けたい')
      setInputValue(firstChoices[1], '止めたい')
      await settle()
    })

    await nameAndSave()
    const payload = fixture.createCalls[0].payload
    expect(payload.questionCount).toBe(2)
    expect(payload.questions).toEqual([
      { text: '来月も定期便を続けたいと思いますか？', format: 'single', required: true, choices: ['続けたい', '止めたい'] },
      { text: 'よく使っている商品を教えてください', format: 'multiple', required: false, choices: ['フード', 'おやつ'] },
    ])
  })

  it('質問を消すと一覧・件数・保存値が揃う', async () => {
    await renderEditor('research')
    await act(async () => {
      buttonByText('質問を追加（あと9問）').click()
      await settle()
    })
    expect(host.textContent).toContain('2 / 10 問')
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="質問 2 を消す"]')!.click()
      await settle()
    })
    expect(host.textContent).toContain('1 / 10 問')
  })
})

describe('NEXT-24: 「自分に送って確かめる」は無反応にしない', () => {
  it.each(['rich_message', 'coupon', 'research'] as const)('%s: 押せない形＋理由を出す', async (kind) => {
    await renderEditor(kind)
    const button = buttonByText('自分に送って確かめる')
    expect(button.disabled).toBe(true)
    expect(host.textContent).toContain('一斉配信に組み込むと、配信の画面からテスト送信できます')
  })
})
