// @vitest-environment happy-dom
// @vitest-environment-options { "url": "http://localhost/rich-menus/" }
import React, { act } from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const searchParams = vi.hoisted(() => ({ value: new URLSearchParams() }))
const routerPush = vi.hoisted(() => vi.fn())
const richMenuGet = vi.hoisted(() => vi.fn())
const richMenuUpdate = vi.hoisted(() => vi.fn())
const richMenuSchedule = vi.hoisted(() => vi.fn())
const richMenuPreviewTargets = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPush, replace: () => {}, refresh: () => {},
    back: () => {}, forward: () => {}, prefetch: () => {},
  }),
  useSearchParams: () => searchParams.value,
  usePathname: () => '/rich-menus/edit',
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))

const selectedAccount = vi.hoisted(() => ({ id: 'acc-1', name: 'テスト店' }))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: 'acc-1',
    selectedAccount,
    accounts: [], loading: false,
  }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
}))

/*
 * 条件の組み立て部品は複雑なので、ここでは「押すと条件が1件入る」
 * 最小のスタブにする。試したいのは条件の保存状態の言い分けで、
 * 条件の組み立て自体ではない。
 */
vi.mock('@/components/shared/condition-builder', () => ({
  default: ({ onChange, label }: { onChange?: (value: unknown) => void; label?: string }) =>
    React.createElement(
      'button',
      {
        type: 'button',
        'aria-label': label ?? '条件',
        onClick: () =>
          onChange?.({ operator: 'AND', rules: [{ type: 'name', value: { text: '追加した条件' } }] }),
      },
      '条件を足す(スタブ)',
    ),
}))

const GROUP = {
  id: 'grp-1', accountId: 'acc-1', name: 'メインメニュー', chatBarText: 'メニュー',
  size: 'large' as const, defaultPageId: 'pg-1', isDefaultForAll: false,
  status: 'draft' as const, publishingAt: null,
  targetingCondition: null, targetingPriority: 0, targetingEnabled: false,
  folderId: null,
  pages: [{
    id: 'pg-1', orderIndex: 0, name: 'トップ', aliasId: '',
    lineRichmenuId: null, imageR2Key: null, imageContentType: null, areas: [],
  }],
}

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  describeSaveFailure: () => '保存できませんでした。もう一度お試しください。',
  api: {
    folders: { list: () => Promise.resolve({ success: true, data: [] }) },
    tags: { list: () => Promise.resolve({ success: true, data: [] }) },
    templates: { list: () => Promise.resolve({ success: true, data: [] }) },
    forms: { list: () => Promise.resolve({ success: true, data: [] }) },
    trackedLinks: { list: () => Promise.resolve({ success: true, data: [] }) },
    richMenuGroups: {
      get: richMenuGet,
      update: richMenuUpdate,
      tapStats: () => Promise.resolve({ success: true, data: { byArea: [] } }),
      list: () => Promise.resolve({ success: true, data: [] }),
      listSchedules: () => Promise.resolve({ success: true, data: [] }),
      schedule: richMenuSchedule,
      previewTargets: richMenuPreviewTargets,
      audienceSummary: () => Promise.resolve({ success: true, data: { total: { value: 0, state: 'available', reason: null }, targeted: { value: 0, state: 'available', reason: null }, excluded: { value: 0, state: 'available', reason: null }, effective: { value: 0, state: 'available', reason: null } } }),
      imageUrl: (key: string) => `/img/${key}`,
    },
    // N-152/N-156: 編集画面は操作者の役割を読んで staff には集計だけを出す。
    staff: { me: () => Promise.resolve({ success: true, data: { role: 'owner' } }) },
  },
}))

import NewRichMenuPage from './new/page'
import RichMenuEditPage from './edit/page'

async function flush() {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

async function type(input: Element, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  // happy-dom は <a href> のクリックで実際に location を動かすため、
  // 先行テストの遷移が残らないよう毎回URLを戻す。
  ;(window as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM
    .setURL('http://localhost/rich-menus/')
  searchParams.value = new URLSearchParams()
  routerPush.mockReset()
  richMenuGet.mockReset()
  richMenuGet.mockImplementation(() => Promise.resolve({ success: true, data: GROUP }))
  richMenuUpdate.mockReset()
  richMenuUpdate.mockImplementation(() => Promise.resolve({ success: true, data: GROUP }))
  richMenuSchedule.mockReset()
  richMenuSchedule.mockImplementation(() => Promise.resolve({ success: true, data: { id: 'sch-1' } }))
  richMenuPreviewTargets.mockReset()
  richMenuPreviewTargets.mockImplementation(() => Promise.resolve({ success: true, data: null }))
})

afterEach(() => {
  cleanup()
})

describe('リッチメニュー新規作成の未保存ガード (N-162)', () => {
  test('未入力のまま一覧リンクを押しても確認は出ない', async () => {
    render(<NewRichMenuPage />)
    await flush()

    fireEvent.click(screen.getByText('リッチメニュー'))
    await flush()
    expect(screen.queryByText('入力中の内容があります')).toBeNull()
    expect(routerPush).not.toHaveBeenCalled()
  })

  test('入力後に一覧リンクを押すと確認が出て、続けるを選ぶと残る', async () => {
    render(<NewRichMenuPage />)
    await flush()

    await type(screen.getByLabelText('メニュー名'), '季節メニュー')
    fireEvent.click(screen.getByText('リッチメニュー'))
    await flush()

    // 確認窓が出て遷移は止まる
    expect(screen.getByText('入力中の内容があります')).toBeTruthy()
    expect(routerPush).not.toHaveBeenCalled()

    // 「入力を続ける」で閉じる
    fireEvent.click(screen.getByText('入力を続ける'))
    await flush()
    expect(screen.queryByText('入力中の内容があります')).toBeNull()
    // 入力は残る
    expect((screen.getByLabelText('メニュー名') as HTMLInputElement).value).toBe('季節メニュー')
  })

  test('確認で「保存せずに移動」を選ぶと遷移する', async () => {
    render(<NewRichMenuPage />)
    await flush()

    await type(screen.getByLabelText('メニュー名'), '季節メニュー')
    fireEvent.click(screen.getByText('リッチメニュー'))
    await flush()
    fireEvent.click(screen.getByText('保存せずに移動'))
    await flush()
    expect(routerPush).toHaveBeenCalledWith('/rich-menus')
  })

  test('入力中の再読み込みはbeforeunloadで止まる', async () => {
    render(<NewRichMenuPage />)
    await flush()

    await type(screen.getByLabelText('メニュー名'), '季節メニュー')
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('リッチメニュー編集の未保存ガード (N-162)', () => {
  test('読み込み直後は変更なしなので一覧リンクを押しても確認は出ない', async () => {
    searchParams.value = new URLSearchParams('id=grp-1')
    render(<RichMenuEditPage />)
    await flush()

    await screen.findByDisplayValue('メインメニュー')
    fireEvent.click(screen.getByText('リッチメニュー'))
    await flush()
    expect(screen.queryByText('保存していない変更があります')).toBeNull()
  })

  test('変更後に一覧リンクを押すと確認が出る', async () => {
    searchParams.value = new URLSearchParams('id=grp-1')
    render(<RichMenuEditPage />)
    await flush()

    const nameInput = await screen.findByDisplayValue('メインメニュー')
    await type(nameInput, 'メインメニュー改')
    fireEvent.click(screen.getByText('リッチメニュー'))
    await flush()

    expect(screen.getByText('保存していない変更があります')).toBeTruthy()
    expect(routerPush).not.toHaveBeenCalled()
  })

  test('保存し終わると警告は出なくなる', async () => {
    searchParams.value = new URLSearchParams('id=grp-1')
    render(<RichMenuEditPage />)
    await flush()

    const nameInput = await screen.findByDisplayValue('メインメニュー')
    await type(nameInput, 'メインメニュー改')
    // 保存（update→再読込で署名が更新される）
    fireEvent.click(screen.getByText('下書きに保存'))
    await act(async () => { await Promise.resolve() })
    await flush()

    expect(richMenuUpdate).toHaveBeenCalled()
    fireEvent.click(screen.getByText('リッチメニュー'))
    await flush()
    expect(screen.queryByText('保存していない変更があります')).toBeNull()
  })

  test('step=targeting でも離脱確認が出る（どの段階でも窓は届く）', async () => {
    searchParams.value = new URLSearchParams('id=grp-1&step=targeting')
    render(<RichMenuEditPage />)
    await flush()

    // 出し分けをONにしてdirty化（2つ目の audience radio が「条件に当てはまる友だちだけ」）
    await screen.findByText('このメニューを出す相手')
    const radios = document.querySelectorAll<HTMLInputElement>('input[name="audience"]')
    fireEvent.click(radios[1])
    await flush()
    fireEvent.click(screen.getByText('リッチメニュー'))
    await flush()

    expect(screen.getByText('保存していない変更があります')).toBeTruthy()
    expect(routerPush).not.toHaveBeenCalled()
  })

  test('ステップ移動は同一画面の段階移動なので確認を出さない', async () => {
    searchParams.value = new URLSearchParams('id=grp-1')
    render(<RichMenuEditPage />)
    await flush()

    const nameInput = await screen.findByDisplayValue('メインメニュー')
    await type(nameInput, 'メインメニュー改')
    // StepHeader の「誰に出すか」（step=targeting）を押しても、入力は消えない画面内移動
    const stepButton = screen.getAllByText('誰に出すか').find((el) => el.closest('button'))
    fireEvent.click(stepButton!.closest('button')!)
    await flush()
    expect(screen.queryByText('保存していない変更があります')).toBeNull()
    expect(routerPush).toHaveBeenCalledWith('/rich-menus/edit?id=grp-1&step=targeting')
  })
})

/*
 * RICHMENU-06: STEP3「公開のしかた」の入力は工程をまたいで保持する。
 * 以前は工程の部品の中にだけ状態があり、STEP2→STEP3 の往復で
 * 「いますぐ出す」へ黙って戻り、日時も消えていた。
 */
describe('公開のしかたの入力保持 (RICHMENU-06)', () => {
  /** searchParams を差し替えて再描画し、画面内の工程移動を再現する。 */
  async function gotoStep(view: ReturnType<typeof render>, step: string | null) {
    searchParams.value = new URLSearchParams(step ? `id=grp-1&step=${step}` : 'id=grp-1')
    view.rerender(<RichMenuEditPage />)
    await flush()
  }

  async function fillPublishSchedule() {
    const radios = document.querySelectorAll<HTMLInputElement>('input[name="publish-mode"]')
    // [0] いますぐ出す / [1] 日時を決めて出す / [2] 期間を決める
    fireEvent.click(radios[1])
    await flush()
    await type(screen.getByLabelText('出しはじめ'), '2026-10-01T10:00')
  }

  test('日時を決めて出す＋日時入力がSTEP1→STEP3の往復で消えない', async () => {
    searchParams.value = new URLSearchParams('id=grp-1&step=publish')
    const view = render(<RichMenuEditPage />)
    await flush()
    await screen.findByText('いつ出すか')

    await fillPublishSchedule()

    await gotoStep(view, null)
    await screen.findByDisplayValue('メインメニュー')
    await gotoStep(view, 'publish')
    await screen.findByText('いつ出すか')

    const radios = document.querySelectorAll<HTMLInputElement>('input[name="publish-mode"]')
    expect(radios[1].checked).toBe(true)
    expect((screen.getByLabelText('出しはじめ') as HTMLInputElement).value).toBe('2026-10-01T10:00')
  })

  test('期間を決める＋出しおわり＋戻し先がSTEP往復で消えない', async () => {
    searchParams.value = new URLSearchParams('id=grp-1&step=publish')
    const view = render(<RichMenuEditPage />)
    await flush()
    await screen.findByText('いつ出すか')

    const radios = document.querySelectorAll<HTMLInputElement>('input[name="publish-mode"]')
    fireEvent.click(radios[2])
    await flush()
    await type(screen.getByLabelText('出しはじめ'), '2026-10-01T10:00')
    await type(screen.getByLabelText('出しおわり'), '2026-10-07T10:00')

    await gotoStep(view, 'targeting')
    await screen.findByText('このメニューを出す相手')
    await gotoStep(view, 'publish')
    await screen.findByText('いつ出すか')

    expect(document.querySelectorAll<HTMLInputElement>('input[name="publish-mode"]')[2].checked).toBe(true)
    expect((screen.getByLabelText('出しはじめ') as HTMLInputElement).value).toBe('2026-10-01T10:00')
    expect((screen.getByLabelText('出しおわり') as HTMLInputElement).value).toBe('2026-10-07T10:00')
  })

  test('公開日時を入れたまま一覧へ離れると確認が出る（dirty署名に含まれる）', async () => {
    searchParams.value = new URLSearchParams('id=grp-1&step=publish')
    render(<RichMenuEditPage />)
    await flush()
    await screen.findByText('いつ出すか')

    await fillPublishSchedule()

    fireEvent.click(screen.getByText('リッチメニュー'))
    await flush()
    expect(screen.getByText('保存していない変更があります')).toBeTruthy()
    expect(routerPush).not.toHaveBeenCalled()
  })

  test('離脱確認を取消すと公開入力はそのまま残る', async () => {
    searchParams.value = new URLSearchParams('id=grp-1&step=publish')
    render(<RichMenuEditPage />)
    await flush()
    await screen.findByText('いつ出すか')

    await fillPublishSchedule()

    fireEvent.click(screen.getByText('リッチメニュー'))
    await flush()
    fireEvent.click(screen.getByText('編集を続ける'))
    await flush()

    expect(screen.queryByText('保存していない変更があります')).toBeNull()
    expect(document.querySelectorAll<HTMLInputElement>('input[name="publish-mode"]')[1].checked).toBe(true)
    expect((screen.getByLabelText('出しはじめ') as HTMLInputElement).value).toBe('2026-10-01T10:00')
  })

  test('「保存せずに移動」を選ぶと公開入力は初期値へ戻る', async () => {
    searchParams.value = new URLSearchParams('id=grp-1&step=publish')
    const view = render(<RichMenuEditPage />)
    await flush()
    await screen.findByText('いつ出すか')

    await fillPublishSchedule()

    fireEvent.click(screen.getByText('リッチメニュー'))
    await flush()
    fireEvent.click(screen.getByText('保存せずに移動'))
    await flush()
    expect(routerPush).toHaveBeenCalledWith('/rich-menus')

    // 捨てることを選んだので、開き直すと「いますぐ出す」・日時なしに戻る
    searchParams.value = new URLSearchParams('id=grp-1&step=publish')
    view.rerender(<RichMenuEditPage />)
    await flush()
    await screen.findByText('いつ出すか')
    expect(document.querySelectorAll<HTMLInputElement>('input[name="publish-mode"]')[0].checked).toBe(true)
    expect(screen.queryByLabelText('出しはじめ')).toBeNull()
  })

  test('下書き保存に失敗しても公開方法と日時は残る', async () => {
    searchParams.value = new URLSearchParams('id=grp-1&step=publish')
    render(<RichMenuEditPage />)
    await flush()
    await screen.findByText('いつ出すか')

    await fillPublishSchedule()

    richMenuUpdate.mockImplementationOnce(() => Promise.resolve({ success: false, error: 'x' }))
    fireEvent.click(screen.getByText('下書きに保存'))
    await flush()

    expect(document.querySelectorAll<HTMLInputElement>('input[name="publish-mode"]')[1].checked).toBe(true)
    expect((screen.getByLabelText('出しはじめ') as HTMLInputElement).value).toBe('2026-10-01T10:00')
  })

  test('公開予約を保存できたら、その内容は未保存扱いにしない', async () => {
    searchParams.value = new URLSearchParams('id=grp-1&step=publish')
    render(<RichMenuEditPage />)
    await flush()
    await screen.findByText('いつ出すか')

    await fillPublishSchedule()
    fireEvent.click(screen.getByText('この内容で予約する'))
    await flush()
    expect(richMenuSchedule).toHaveBeenCalled()

    // 予約できた内容は保存済みなので、一覧への離脱で確認は出ない
    fireEvent.click(screen.getByText('リッチメニュー'))
    await flush()
    expect(screen.queryByText('保存していない変更があります')).toBeNull()
  })
})

