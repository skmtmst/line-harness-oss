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
const richMenuPublish = vi.hoisted(() => vi.fn())
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
      publish: richMenuPublish,
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

/** searchParams を差し替えて再描画し、画面内の工程移動を再現する。 */
async function gotoStep(view: ReturnType<typeof render>, step: string | null) {
  searchParams.value = new URLSearchParams(step ? `id=grp-1&step=${step}` : 'id=grp-1')
  view.rerender(<RichMenuEditPage />)
  await flush()
}

const WEEK = '日月火水木金土'

/** 出しはじめ・出しおわりを日時の選択（★V7）で選ぶ。値は今までどおり YYYY-MM-DDTHH:mm。 */
async function pickDateTime(label: string, iso: string) {
  const [date, time] = iso.split('T')
  const [hour, minute] = time.split(':')
  const [y, mo, d] = date.split('-').map(Number)
  const week = WEEK[new Date(y, mo - 1, d).getDay()]
  fireEvent.click(screen.getByLabelText(label))
  const picker = document.querySelector('[role="dialog"][aria-label="日時を選ぶ"]')!
  fireEvent.click(picker.querySelector('button[aria-label="日付"]')!)
  for (let i = 0; i < 24; i += 1) {
    const grid = document.querySelector('[role="grid"]')
    if (grid?.getAttribute('aria-label') === `${y}年${mo}月`) break
    const currentLabel = /^(\d+)年(\d+)月$/.exec(grid?.getAttribute('aria-label') ?? '')
    const current = currentLabel ? Number(currentLabel[1]) * 12 + Number(currentLabel[2]) : y * 12 + mo
    const nav = [...document.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === (y * 12 + mo >= current ? '次の月' : '前の月'),
    )!
    fireEvent.click(nav)
  }
  fireEvent.click([...document.querySelectorAll('button')].find((b) =>
    (b.getAttribute('aria-label') ?? '').startsWith(`${y}年${mo}月${d}日（${week}）`),
  )!)
  const reopened = document.querySelector('[role="dialog"][aria-label="日時を選ぶ"]')!
  fireEvent.change(reopened.querySelector('select[aria-label="時"]')!, { target: { value: hour } })
  fireEvent.change(reopened.querySelector('select[aria-label="分"]')!, { target: { value: minute } })
  fireEvent.click([...reopened.querySelectorAll('button')].find((b) => b.textContent?.trim() === '閉じる')!)
  await flush()
}

async function fillPublishSchedule() {
  const radios = document.querySelectorAll<HTMLInputElement>('input[name="publish-mode"]')
  // [0] いますぐ出す / [1] 日時を決めて出す / [2] 期間を決める
  fireEvent.click(radios[1])
  await flush()
  await pickDateTime('出しはじめ', '2026-10-01T10:00')
}

/** 試験ごとに空で始めるための localStorage 代替。 */
class MemoryStorage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
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
  richMenuPublish.mockReset()
  richMenuPublish.mockImplementation(() => Promise.resolve({ success: true, data: { pages: [] } }))
  // 公開入力の下書きは localStorage に残る。試験ごとに空で始める。
  vi.stubGlobal('localStorage', new MemoryStorage())
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
    expect(screen.getByLabelText('出しはじめ').textContent).toContain('2026年10月1日（木）10:00')
  })

  test('期間を決める＋出しおわり＋戻し先がSTEP往復で消えない', async () => {
    searchParams.value = new URLSearchParams('id=grp-1&step=publish')
    const view = render(<RichMenuEditPage />)
    await flush()
    await screen.findByText('いつ出すか')

    const radios = document.querySelectorAll<HTMLInputElement>('input[name="publish-mode"]')
    fireEvent.click(radios[2])
    await flush()
    await pickDateTime('出しはじめ', '2026-10-01T10:00')
    await pickDateTime('出しおわり', '2026-10-07T10:00')

    await gotoStep(view, 'targeting')
    await screen.findByText('このメニューを出す相手')
    await gotoStep(view, 'publish')
    await screen.findByText('いつ出すか')

    expect(document.querySelectorAll<HTMLInputElement>('input[name="publish-mode"]')[2].checked).toBe(true)
    expect(screen.getByLabelText('出しはじめ').textContent).toContain('2026年10月1日（木）10:00')
    expect(screen.getByLabelText('出しおわり').textContent).toContain('2026年10月7日（水）10:00')
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
    expect(screen.getByLabelText('出しはじめ').textContent).toContain('2026年10月1日（木）10:00')
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
    expect(screen.getByLabelText('出しはじめ').textContent).toContain('2026年10月1日（木）10:00')
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

/*
 * DEEP-27: 未保存で足した条件が「保存済み条件」と出ると、保存したつもりで
 * 画面を離れてしまう。保存済みの条件と同じかどうかで表示を分ける。
 */
describe('条件の保存状態の表示 (DEEP-27)', () => {
  const GROUP_WITH_CONDITION = {
    ...GROUP,
    targetingEnabled: true,
    targetingCondition: JSON.stringify({
      operator: 'AND',
      rules: [{ type: 'private_memo', value: '保存済み' }],
    }),
  }

  test('保存済み条件は「保存済み」、直した条件は「未保存」と区別する', async () => {
    richMenuGet.mockImplementation(() => Promise.resolve({ success: true, data: GROUP_WITH_CONDITION }))
    searchParams.value = new URLSearchParams('id=grp-1&step=targeting')
    render(<RichMenuEditPage />)
    await flush()

    await screen.findByText('保存済み条件 1件')

    fireEvent.click(screen.getByText('条件を編集'))
    await flush()
    // スタブの条件組み立て: 押すと別の条件が1件入る
    fireEvent.click(screen.getByText('条件を足す(スタブ)'))
    await flush()

    expect(screen.getByText('条件 1件（未保存）')).toBeTruthy()
    expect(screen.queryByText('保存済み条件 1件')).toBeNull()
  })
})

/*
 * RICHMENU-03: 条件をONにしたのに条件が空だと保存できず誰にも出ない。
 * STEP1 は「誰にも出しません」と案内するが、STEP2 は人数APIが空条件を
 * 全員として数えるため「当てはまる5人/出る5人」と食い違って見えた。
 * 対象の説明を両工程で揃える（数え方そのものは変えない）。
 */
describe('条件が空のときの対象説明 (RICHMENU-03)', () => {
  const GROUP_EMPTY_CONDITION = {
    ...GROUP,
    targetingEnabled: true,
    targetingCondition: null,
  }
  const EMPTY_WARNING = '条件が空です。このままだと誰にも出しません。条件を1つ以上足してください。'

  test('条件ON・空条件ではSTEP2も「誰にも出しません」で0人と案内する', async () => {
    richMenuGet.mockImplementation(() => Promise.resolve({ success: true, data: GROUP_EMPTY_CONDITION }))
    searchParams.value = new URLSearchParams('id=grp-1&step=targeting')
    render(<RichMenuEditPage />)
    await flush()

    await screen.findByText('このメニューを出す相手')
    expect(screen.getByText(EMPTY_WARNING)).toBeTruthy()
    // 「いま当てはまる人」「実際にこのメニューが出る人」は 0人 と出す
    expect(screen.getAllByText('0人')).toHaveLength(2)
  })

  test('同じ状態でSTEP1も同じ案内を出す', async () => {
    richMenuGet.mockImplementation(() => Promise.resolve({ success: true, data: GROUP_EMPTY_CONDITION }))
    searchParams.value = new URLSearchParams('id=grp-1')
    render(<RichMenuEditPage />)
    await flush()

    await screen.findByDisplayValue('メインメニュー')
    expect(screen.getByText(EMPTY_WARNING)).toBeTruthy()
  })
})

/*
 * 公開前チェックの人数は、保存前の条件ではなく「いま編集中の条件」で数える。
 * 人数API(previewTargets)には常に編集中の条件を渡す。条件が空なら
 * STEP2 と同じく 0人＋誰にも出しません にそろえる。
 */
describe('公開前チェックの人数（未保存条件）', () => {
  const GROUP_WITH_CONDITION = {
    ...GROUP,
    targetingEnabled: true,
    targetingCondition: JSON.stringify({
      operator: 'AND',
      rules: [{ type: 'private_memo', value: '保存済み' }],
    }),
  }
  const STUB_CONDITION = {
    operator: 'AND',
    rules: [{ type: 'name', value: { text: '追加した条件' } }],
  }

  async function editConditionUnsaved() {
    fireEvent.click(screen.getByText('条件を編集'))
    await flush()
    // スタブの条件組み立て: 押すと別の条件が1件入る
    fireEvent.click(screen.getByText('条件を足す(スタブ)'))
    await flush()
  }

  /** 人数の再取得は250msのデバウンス。実時間で待ってから通信の引数を見る。 */
  async function waitPreviewFetch() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)) })
    await flush()
  }

  test('条件を未保存で直すと、人数APIへその未保存条件が渡る', async () => {
    richMenuGet.mockImplementation(() => Promise.resolve({ success: true, data: GROUP_WITH_CONDITION }))
    searchParams.value = new URLSearchParams('id=grp-1&step=targeting')
    render(<RichMenuEditPage />)
    await flush()
    await screen.findByText('このメニューを出す相手')

    await editConditionUnsaved()
    await waitPreviewFetch()

    expect(richMenuPreviewTargets).toHaveBeenCalled()
    expect(richMenuPreviewTargets).toHaveBeenLastCalledWith('grp-1', STUB_CONDITION)
    // 人数のそばに「未保存の条件で数えている」と出る
    expect(screen.getByText('人数はまだ保存していない条件で数えています')).toBeTruthy()
  })

  test('未保存の条件では、STEP3の公開前チェックと右の欄にも注記が出る', async () => {
    richMenuGet.mockImplementation(() => Promise.resolve({ success: true, data: GROUP_WITH_CONDITION }))
    searchParams.value = new URLSearchParams('id=grp-1&step=targeting')
    const view = render(<RichMenuEditPage />)
    await flush()
    await screen.findByText('このメニューを出す相手')
    await editConditionUnsaved()

    await gotoStep(view, 'publish')
    await screen.findByText('いつ出すか')

    // 公開前チェックの人数に「未保存の条件で計算」、右の欄に「（未保存の条件）」
    expect(screen.getByText(/未保存の条件で計算/)).toBeTruthy()
    expect(screen.getByText('（未保存の条件）')).toBeTruthy()
  })

  test('保存済みの条件のままなら、注記は出ない', async () => {
    richMenuGet.mockImplementation(() => Promise.resolve({ success: true, data: GROUP_WITH_CONDITION }))
    searchParams.value = new URLSearchParams('id=grp-1&step=publish')
    render(<RichMenuEditPage />)
    await flush()
    await screen.findByText('いつ出すか')

    expect(screen.queryByText(/未保存の条件/)).toBeNull()
  })

  test('条件が空なら STEP3 も 0人＋誰にも出しません にそろう', async () => {
    const GROUP_EMPTY_CONDITION = { ...GROUP, targetingEnabled: true, targetingCondition: null }
    richMenuGet.mockImplementation(() => Promise.resolve({ success: true, data: GROUP_EMPTY_CONDITION }))
    searchParams.value = new URLSearchParams('id=grp-1&step=publish')
    render(<RichMenuEditPage />)
    await flush()
    await screen.findByText('いつ出すか')

    // 空条件は誰にも出ない。人数APIの全員カウントで誤魔化さない。
    expect(screen.getByText(/誰にも出しません（0人）/)).toBeTruthy()
    expect(screen.queryByText(/誰に出すかが決まっています/)).toBeNull()
    // 右の欄と「公開すると何が変わるか」も 0人 でそろえる
    expect(screen.getByText('0人')).toBeTruthy()
    expect(screen.getByText(/0人 のトーク画面のメニューが入れ替わります/)).toBeTruthy()
  })
})

/*
 * 公開のしかたの入力は、サーバーの下書きpayloadに乗せる欄が無いので
 * メニューIDごとに localStorage へ下書き保存する。再読込・タブ終了で
 * 消えず、別メニューの下書きと混ざらない。「保存せずに移動」・公開予約の
 * 保存成功・LINE登録・メニュー削除で消す。
 */
describe('公開入力の下書き（localStorage）', () => {
  const DRAFT_KEY = 'lh_rich_menu_publish_plan_grp-1'

  test('再読込すると公開方法と日時が復元される', async () => {
    searchParams.value = new URLSearchParams('id=grp-1&step=publish')
    const view = render(<RichMenuEditPage />)
    await flush()
    await screen.findByText('いつ出すか')
    await fillPublishSchedule()
    expect(localStorage.getItem(DRAFT_KEY)).toBeTruthy()

    // ブラウザ再読込相当（アンマウントして開き直す）
    view.unmount()
    render(<RichMenuEditPage />)
    await flush()
    await screen.findByText('いつ出すか')

    expect(document.querySelectorAll<HTMLInputElement>('input[name="publish-mode"]')[1].checked).toBe(true)
    expect(screen.getByLabelText('出しはじめ').textContent).toContain('2026年10月1日（木）10:00')
  })

  test('期間公開の入力（出しおわり・戻し先）も復元される', async () => {
    searchParams.value = new URLSearchParams('id=grp-1&step=publish')
    const view = render(<RichMenuEditPage />)
    await flush()
    await screen.findByText('いつ出すか')

    const radios = document.querySelectorAll<HTMLInputElement>('input[name="publish-mode"]')
    fireEvent.click(radios[2])
    await flush()
    await pickDateTime('出しはじめ', '2026-10-01T10:00')
    await pickDateTime('出しおわり', '2026-10-07T10:00')

    view.unmount()
    render(<RichMenuEditPage />)
    await flush()
    await screen.findByText('いつ出すか')

    expect(document.querySelectorAll<HTMLInputElement>('input[name="publish-mode"]')[2].checked).toBe(true)
    expect(screen.getByLabelText('出しはじめ').textContent).toContain('2026年10月1日（木）10:00')
    expect(screen.getByLabelText('出しおわり').textContent).toContain('2026年10月7日（水）10:00')
  })

  test('「保存せずに移動」を選ぶと下書きも消える', async () => {
    searchParams.value = new URLSearchParams('id=grp-1&step=publish')
    render(<RichMenuEditPage />)
    await flush()
    await screen.findByText('いつ出すか')
    await fillPublishSchedule()
    expect(localStorage.getItem(DRAFT_KEY)).toBeTruthy()

    fireEvent.click(screen.getByText('リッチメニュー'))
    await flush()
    fireEvent.click(screen.getByText('保存せずに移動'))
    await flush()

    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  test('公開予約の保存に成功すると下書きは消える', async () => {
    searchParams.value = new URLSearchParams('id=grp-1&step=publish')
    render(<RichMenuEditPage />)
    await flush()
    await screen.findByText('いつ出すか')
    await fillPublishSchedule()
    expect(localStorage.getItem(DRAFT_KEY)).toBeTruthy()

    fireEvent.click(screen.getByText('この内容で予約する'))
    await flush()

    expect(richMenuSchedule).toHaveBeenCalled()
    // 予約できた内容が「未保存の入力」として復活しないよう、下書きは消す
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  test('LINE登録に成功すると下書きは消える', async () => {
    searchParams.value = new URLSearchParams('id=grp-1&step=publish')
    render(<RichMenuEditPage />)
    await flush()
    await screen.findByText('いつ出すか')
    await fillPublishSchedule()

    // 「いますぐ出す」へ戻しても日時は入力の中に残り、下書きも残る
    fireEvent.click(document.querySelectorAll<HTMLInputElement>('input[name="publish-mode"]')[0])
    await flush()
    expect(localStorage.getItem(DRAFT_KEY)).toBeTruthy()

    fireEvent.click(screen.getByText('この内容で公開する'))
    await flush()

    expect(richMenuPublish).toHaveBeenCalled()
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  test('別メニューにはそのメニューの下書きだけが復元される', async () => {
    searchParams.value = new URLSearchParams('id=grp-1&step=publish')
    const view = render(<RichMenuEditPage />)
    await flush()
    await screen.findByText('いつ出すか')
    await fillPublishSchedule()

    // 別メニュー（grp-2）の編集へ移る。grp-1 の下書きは出ない。
    searchParams.value = new URLSearchParams('id=grp-2&step=publish')
    view.rerender(<RichMenuEditPage />)
    await flush()
    await screen.findByText('いつ出すか')
    expect(document.querySelectorAll<HTMLInputElement>('input[name="publish-mode"]')[0].checked).toBe(true)
    expect(screen.queryByLabelText('出しはじめ')).toBeNull()
    // grp-1 の下書き自体は消えない
    expect(localStorage.getItem(DRAFT_KEY)).toBeTruthy()

    // grp-1 へ戻ると下書きが復元される
    searchParams.value = new URLSearchParams('id=grp-1&step=publish')
    view.rerender(<RichMenuEditPage />)
    await flush()
    await screen.findByText('いつ出すか')
    expect(document.querySelectorAll<HTMLInputElement>('input[name="publish-mode"]')[1].checked).toBe(true)
    expect(screen.getByLabelText('出しはじめ').textContent).toContain('2026年10月1日（木）10:00')
  })
})
