// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 友だち詳細の表示と動作の食い違い（#991 NEXT-08〜11）を本物のReactで固定する。
 *
 *   NEXT-08: 上部の「個別操作」「…」が無反応だった。
 *            共通メニューへ接続し、選んだ項目が画面遷移・操作に届くことを固定する。
 *   NEXT-09: 「テンプレートを送信」などが汎用一覧へ飛ぶだけで対象が消えていた。
 *            「シナリオに登録」はこの友だちを対象に選んで実行でき、
 *            一覧へ行くだけの入口は「一覧を見る」と正直な名前にしたことを固定する。
 *   NEXT-10: 「最近の履歴」は友だち追加1行の生成物、「すべてを見る」は未接続だった。
 *            /api/friends/:id/timeline につなぎ、0件・取得失敗を区別して表示する。
 *            名寄せ件数は実際の統合情報（マイル口の insights）から出す。
 *   NEXT-11: 本体・情報欄・マイル・リッチメニューを Promise.all で待っていたため、
 *            遅いマイルが顧客名の表示まで止めていた。本体だけ先に出し、
 *            補助パネルは独立して読み込み・再試行できることを固定する。
 *
 * 差し替えるのは api / fetchApi（サーバーとの境界）と next/navigation・
 * next/link だけ。画面の中身は本物のまま動かす。
 */

const fixtures = vi.hoisted(() => ({
  friendDetail: {
    id: 'friend-1',
    displayName: 'テスト太郎',
    pictureUrl: null,
    isFollowing: true,
    tags: [],
    formSubmissions: [],
    support: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    firstTrackedLinkName: '春のキャンペーン',
  },
  mileageData: {
    summary: {
      programId: 'prog-1',
      programName: 'マイル',
      available: 120,
      pending: 0,
      lifetimeEarned: 300,
      spent: 180,
    },
    history: [],
    insights: {
      accountCount: 2,
      rewardedActions: 5,
      referralMiles: 0,
      qualityReferralCount: 0,
      lastEarnedAt: null,
    },
    connections: [
      { accountId: 'account-a', accountName: '本店アカウント', friendId: 'friend-1' },
      { accountId: 'account-b', accountName: '支店アカウント', friendId: 'friend-9' },
    ],
  },
  scenarios: [
    {
      id: 'sc-1',
      name: 'お迎えシナリオ',
      description: null,
      triggerType: 'manual',
      triggerTagId: null,
      lineAccountId: 'account-a',
      isActive: true,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
  ],
  timelineItems: [
    {
      id: 'ev-1',
      type: 'message_received',
      summary: 'メッセージを受信しました',
      occurredAt: '2026-09-10T10:00:00.000Z',
      lineAccount: { id: 'account-a', name: '本店アカウント' },
    },
    {
      id: 'ev-2',
      type: 'form_submitted',
      summary: '回答フォームへ回答しました',
      occurredAt: '2026-09-05T10:00:00.000Z',
      lineAccount: { id: 'account-a', name: '本店アカウント' },
    },
  ],
}))

const net = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown[] }[],
  pushed: [] as string[],
}))

// 試験ごとに差し替える応答。
const state = vi.hoisted(() => ({
  mileage: undefined as
    | (() => Promise<unknown>)
    | undefined,
  timeline: undefined as
    | (() => Promise<unknown>)
    | undefined,
}))

const routing = vi.hoisted(() => ({
  params: new URLSearchParams('id=friend-1'),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => routing.params,
  useRouter: () => ({
    push: (href: string) => {
      net.pushed.push(href)
    },
    replace: vi.fn(),
  }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null }),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    // 履歴口。state.timeline で応答を差し替える。
    fetchApi: (path: string) => {
      net.calls.push({ name: 'fetchApi', args: [path] })
      const impl = state.timeline
      if (impl) return impl()
      return Promise.resolve({
        success: true,
        data: { items: fixtures.timelineItems, nextCursor: null },
      })
    },
    api: {
      ...actual.api,
      friends: {
        ...actual.api.friends,
        get: (...args: unknown[]) => {
          net.calls.push({ name: 'friends.get', args })
          return Promise.resolve({ success: true, data: fixtures.friendDetail })
        },
        mileage: (...args: unknown[]) => {
          net.calls.push({ name: 'friends.mileage', args })
          const impl = state.mileage
          if (impl) return impl() as Promise<never>
          return Promise.resolve({ success: true, data: fixtures.mileageData })
        },
        richMenu: () =>
          Promise.resolve({ success: true, data: { name: null, isDefault: true } }),
      },
      friendFields: {
        ...actual.api.friendFields,
        forFriend: () =>
          Promise.resolve({
            success: true,
            data: { items: [], hiddenPersonalCount: 0 },
          }),
      },
      scenarios: {
        ...actual.api.scenarios,
        list: (...args: unknown[]) => {
          net.calls.push({ name: 'scenarios.list', args })
          return Promise.resolve({ success: true, data: fixtures.scenarios })
        },
        enroll: (...args: unknown[]) => {
          net.calls.push({ name: 'scenarios.enroll', args })
          return Promise.resolve({ success: true, data: { id: 'sub-1' } })
        },
      },
      featureSettings: {
        ...actual.api.featureSettings,
        visibility: async () => ({
          success: true as const,
          data: { features: { friend_fields: true } },
        }),
      },
    },
  }
})

let host: HTMLDivElement
let root: Root
let FriendDetailPage: typeof import('./page').default

beforeEach(async () => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  net.calls.length = 0
  net.pushed.length = 0
  state.mileage = undefined
  state.timeline = undefined
  routing.params = new URLSearchParams('id=friend-1')
  // シナリオ登録口はオーナー・管理者専用なので管理者として開く。
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'lh_staff_role' ? 'admin' : null),
    setItem: () => {},
    removeItem: () => {},
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  FriendDetailPage = (await import('./page')).default
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function render(tab?: string) {
  routing.params = new URLSearchParams(`id=friend-1${tab ? `&tab=${tab}` : ''}`)
  await act(async () => {
    root.render(React.createElement(FriendDetailPage))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function eventually(check: () => void, timeout = 1_500): Promise<void> {
  const started = Date.now()
  while (true) {
    try {
      check()
      return
    } catch (error) {
      if (Date.now() - started >= timeout) throw error
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
    }
  }
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === text)
  if (!button) throw new Error(`ボタンが見つかりません: ${text}`)
  return button
}

function menuItems(): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
}

describe('NEXT-11 遅い補助パネルが顧客名の表示を止めない', () => {
  it('マイルが返ってこなくても、本体の取得後に顧客名・戻る導線が使える', async () => {
    let finishMileage: (v: unknown) => void = () => {}
    state.mileage = () => new Promise((resolve) => {
      finishMileage = resolve
    })
    await render()

    // マイルの応答を待たずに本体が出る
    await eventually(() => expect(host.textContent).toContain('テスト太郎'))
    expect(host.textContent).not.toContain('読み込み中...')
    // 戻る導線（友だち一覧へのリンク）が使える
    const back = Array.from(host.querySelectorAll('a')).find((a) => a.getAttribute('href') === '/friends')
    expect(back).toBeTruthy()

    // マイルが失敗で返ってきても、顧客名は出たまま・失敗表示はマイル欄だけ
    await act(async () => {
      finishMileage({ success: false, error: 'unavailable' })
    })
    await eventually(() => expect(host.textContent).toContain('マイルを取得できませんでした'))
    expect(host.textContent).toContain('テスト太郎')
  })

  it('マイルの取り損ねには再試行口があり、再試行で値が出る', async () => {
    state.mileage = () => Promise.resolve({ success: false, error: 'unavailable' })
    await render()
    await eventually(() => expect(host.textContent).toContain('マイルを取得できませんでした'))

    state.mileage = () => Promise.resolve({ success: true, data: fixtures.mileageData })
    await act(async () => {
      buttonByText('再試行').click()
    })
    await eventually(() => expect(host.textContent).toContain('120'))
    expect(host.textContent).not.toContain('マイルを取得できませんでした')
  })
})

describe('NEXT-08 「個別操作」「…」が操作メニューにつながる', () => {
  it('「個別操作」を押すとこの友だちへの操作が出て、選ぶと画面遷移する', async () => {
    await render()
    const before = host.innerHTML
    await act(async () => {
      buttonByText('個別操作').click()
    })
    expect(host.innerHTML).not.toBe(before)
    const labels = menuItems().map((b) => b.textContent)
    // ★V7（m13g）：「受信箱で開く」は画面右上のボタンにあるので、メニューには重ねない。
    expect(labels.some((text) => text === '受信箱で開く')).toBe(false)
    expect(labels.some((text) => text?.includes('テンプレートを送る'))).toBe(true)
    expect(labels).toContain('シナリオに登録')

    await act(async () => {
      menuItems().find((b) => b.textContent?.includes('テンプレートを送る'))!.click()
    })
    expect(net.pushed).toContain('/chats?friend=friend-1')
  })

  it('項目に絵が付き、別画面へ行く項目にだけ矢印が付く', async () => {
    await render()
    await act(async () => {
      buttonByText('個別操作').click()
    })
    // どれも左に絵（16px）を持つ。「テンプレートを送る」は別画面なので矢印も持つ。
    for (const item of menuItems()) {
      expect(item.querySelector('svg')).toBeTruthy()
    }
    const template = menuItems().find((b) => b.textContent?.includes('テンプレートを送る'))!
    expect(template.querySelectorAll('svg')).toHaveLength(2)
    await act(async () => {
      buttonByText('個別操作').click()
    })
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="その他の操作"]')!.click()
    })
    // 「戻る」は戻る操作なので矢印が無い（絵だけ）。
    const back = menuItems().find((b) => b.textContent?.includes('友だち一覧へ戻る'))!
    expect(back.querySelectorAll('svg')).toHaveLength(1)
  })

  it('「…」を押すと関連画面への移動が出て、選ぶと画面遷移する', async () => {
    await render()
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="その他の操作"]')!.click()
    })
    const labels = menuItems().map((b) => b.textContent)
    expect(labels).toContain('友だち一覧へ戻る')
    await act(async () => {
      menuItems().find((b) => b.textContent === '友だち一覧へ戻る')!.click()
    })
    expect(net.pushed).toContain('/friends')
  })
})

describe('NEXT-09 対象の友だちを引き継ぐ操作', () => {
  it('「シナリオに登録」は選択肢を開き、選ぶとこの友だちの登録へ届く', async () => {
    await render()
    await eventually(() => expect(host.textContent).toContain('テスト太郎'))

    await act(async () => {
      buttonByText('シナリオに登録').click()
    })
    await eventually(() => expect(host.querySelector('[data-scenario-picker]')).toBeTruthy())
    // 表示中アカウントのシナリオを選択肢として取る
    const listCall = net.calls.find((c) => c.name === 'scenarios.list')
    expect(listCall).toBeTruthy()

    const select = host.querySelector<HTMLSelectElement>('select[aria-label="登録するシナリオを選ぶ"]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(select, 'sc-1')
      select.dispatchEvent(new Event('input', { bubbles: true }))
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    // 選択→確認→実行
    await eventually(() => expect(host.textContent).toContain('を登録します'))
    await act(async () => {
      buttonByText('このシナリオに登録する').click()
    })
    await eventually(() => {
      const call = net.calls.find((c) => c.name === 'scenarios.enroll')
      expect(call).toBeTruthy()
      expect(call!.args).toEqual(['sc-1', 'friend-1'])
    })
    await eventually(() => expect(host.textContent).toContain('に登録しました'))
  })

  // ★V7（2026-09-24）：この友だちに関係の無い「〜一覧を見る」は操作節に置かない（左のメニューから行ける）。
  it('操作節に汎用一覧へ行くだけの入口を置かず、対象を引き継がない「送信」「設定」も名乗らない', async () => {
    await render()
    const hrefs = Array.from(host.querySelectorAll('a')).map((a) => ({
      text: a.textContent,
      href: a.getAttribute('href'),
    }))
    expect(hrefs.some((h) => h.text === 'テンプレート一覧を見る')).toBe(false)
    expect(hrefs.some((h) => h.text === 'シナリオ一覧を見る')).toBe(false)
    expect(hrefs.some((h) => h.text === 'リマインダ一覧を見る')).toBe(false)
    // 対象を引き継がないのに「送信」「設定」を名乗る入口は無い
    expect(hrefs.some((h) => h.text === 'テンプレートを送信')).toBe(false)
    expect(hrefs.some((h) => h.text === 'リマインダを設定')).toBe(false)
  })
})

describe('NEXT-10 履歴は実際の活動履歴につながっている', () => {
  it('「すべてを見る」先の履歴タブが実データを表示する', async () => {
    await render('history')
    await eventually(() => expect(host.textContent).toContain('メッセージを受信しました'))
    expect(host.textContent).toContain('回答フォームへ回答しました')
    // いちばん古い記録として友だち追加が末尾に出る
    expect(host.textContent).toContain('友だち追加')
    expect(host.textContent).toContain('春のキャンペーンから追加されました')
    // 未接続の説明文はもう出ない
    expect(host.textContent).not.toContain('全履歴を取得する仕組みがまだありません')
  })

  it('履歴0件は0件と表示し、友だち追加の記録だけが残る', async () => {
    state.timeline = () => Promise.resolve({ success: true, data: { items: [], nextCursor: null } })
    await render('history')
    await eventually(() => expect(host.textContent).toContain('活動履歴はまだありません'))
    expect(host.textContent).toContain('友だち追加')
    // 0件表示は失敗表示とは違う文面
    expect(host.textContent).not.toContain('履歴を取得できませんでした')
  })

  it('履歴の取得に失敗すると「取得できませんでした」と再試行口が出る', async () => {
    state.timeline = () => Promise.resolve({ success: false, error: 'failed' })
    await render('history')
    await eventually(() => expect(host.textContent).toContain('履歴を取得できませんでした'))
    expect(buttonByText('もう一度読み込む')).toBeTruthy()
    // 0件表示とは違う文面
    expect(host.textContent).not.toContain('活動履歴はまだありません')
  })

  it('名寄せ件数は固定文ではなく実際の統合情報から出す', async () => {
    await render()
    await eventually(() => expect(host.textContent).toContain('2件のLINEアカウントで同じ人としてつながっています'))
    expect(host.textContent).toContain('支店アカウント')
    expect(host.textContent).not.toContain('現在は1アカウントのみ')
  })

  it('つながり情報が取れないときは未取得と表示する', async () => {
    state.mileage = () => Promise.resolve({ success: false, error: 'unavailable' })
    await render()
    await eventually(() => expect(host.textContent).toContain('つながり情報を取得できませんでした'))
  })
})
