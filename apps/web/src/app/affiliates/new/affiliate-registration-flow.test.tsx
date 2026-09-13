// @vitest-environment happy-dom
/*
 * アフィリエイター登録・案件登録を、本物の React で mount して操作する（#686）。
 *
 * **Required gate（`pnpm --filter web test`）から動く。** 前の版は同じ内容を
 * `affiliate-create-flow.spec.ts` に置いていたが、`apps/web/vitest.config.ts`
 * の include は `.test.ts` / `.test.tsx` だけで、playwright の設定も
 * `contents` 用の1本しか無い。そのため CI のどこからも走らないまま
 * 「試験あり」と読まれていた（司令塔独立審査 1）。ここは gate が動かす
 * 場所へ置き直したもの。
 *
 * page.tsx の文字列一致では、書いてあるのに動かない状態を見抜けない。
 * ここは本物の React（react-dom/client）・本物の効果・本物のクリックで、
 * 通信に何が渡ったかだけを見る。差し替えるのは通信（api）と、遷移
 * （next/navigation）と、アカウントの選択（account-context）だけ。
 *
 * 見張る崩れ方:
 *   1. 友だちが先頭20件で頭打ちになり、21件目以降へ届かない
 *   2. 検索が選択中のLINEアカウントへ固定されず、他店の友だちが混ざる
 *   3. 割合0%が「未入力」と同じ扱いになって保存されない
 *   4. 途中保存の後に押し直すと、紹介者が二重にできる
 *   5. 途中保存の後に直した名前が、再開の保存で消える
 *   6. アカウントを切り替えても作りかけが残り、別店の登録を更新する
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/* ------------------------------------------------------------------ 差し替え */

const friendsList = vi.hoisted(() => vi.fn())
const affiliatesCreate = vi.hoisted(() => vi.fn())
const affiliatesUpdate = vi.hoisted(() => vi.fn())
const offersCreate = vi.hoisted(() => vi.fn())
const offersUpdate = vi.hoisted(() => vi.fn())

/*
 * `@/lib/api` は読み込んだ時点で NEXT_PUBLIC_API_URL を要求して落ちる。
 * 画面が実際に呼ぶ口だけを置いた差し替えにして、環境変数に縛られないようにする。
 */
vi.mock('@/lib/api', () => ({
  // CreatePage の後始末が `error instanceof ApiError` を見るので、器だけ揃える。
  ApiError: class ApiError extends Error {},
  api: {
    friends: { list: friendsList },
    affiliates: { create: affiliatesCreate, update: affiliatesUpdate },
    affiliateOffers: { create: offersCreate, update: offersUpdate },
    tags: { list: vi.fn(async () => ({ success: true, data: [] })) },
    scenarios: { list: vi.fn(async () => ({ success: true, data: [] })) },
  },
}))

const pushed = vi.hoisted(() => [] as string[])
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => { pushed.push(href) } }),
}))

/** 画面上部のアカウント切替と同じ context。試験の途中で選択を変える。 */
const account = vi.hoisted(() => ({ id: 'account-a' as string | null, name: '本店' }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: account.id,
    selectedAccount: account.id ? { id: account.id, name: account.name } : null,
    accounts: [
      { id: 'account-a', name: '本店' },
      { id: 'account-b', name: '別店' },
    ],
    setSelectedAccountId: () => {},
    clearSelectedAccountId: () => {},
    refreshAccounts: async () => {},
    loading: false,
  }),
}))

const { default: NewAffiliatePage } = await import('./page')
const { default: NewAffiliateOfferPage } = await import('../../affiliate-offers/new/page')

/* -------------------------------------------------------------- 操作する道具 */

let container: HTMLDivElement
let root: Root

async function mount(element: React.ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(element) })
}

/** 画面を描き直す。state は残るので、context の変化だけが伝わる。 */
async function rerender(element: React.ReactElement) {
  await act(async () => { root.render(element) })
}

function byId<T extends HTMLElement>(id: string): T {
  const found = container.querySelector<T>(`#${id}`)
  if (!found) throw new Error(`#${id} が見つかりません`)
  return found
}

function byLabel<T extends HTMLElement>(label: string): T {
  const found = container.querySelector<T>(`[aria-label="${label}"]`)
  if (!found) throw new Error(`aria-label="${label}" が見つかりません`)
  return found
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (b) => (b.textContent ?? '').trim() === text,
  )
  if (!found) throw new Error(`「${text}」のボタンが見つかりません（今あるのは ${[...container.querySelectorAll('button')].map((b) => b.textContent?.trim()).join(' / ')}）`)
  return found as HTMLButtonElement
}

function hasText(text: string): boolean {
  return (container.textContent ?? '').includes(text)
}

/** React が値の変化を拾えるように、native setter を通してから input を発火する。 */
async function type(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function choose(element: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(element, value)
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

/* ------------------------------------------------------------------ 実データ */

const FRIENDS_A = Array.from({ length: 45 }, (_, i) => ({
  id: `friend-a${i + 1}`,
  displayName: `本店の友だち${i + 1}`,
}))
const FRIENDS_B = [{ id: 'friend-b1', displayName: '別店の友だち1' }]

/** 選択中アカウントの友だちだけを、20件ずつ返す受け口の代役。 */
function friendPage(params: { accountId?: string; offset?: string; limit?: number; search?: string }) {
  const all = params.accountId === 'account-b' ? FRIENDS_B : FRIENDS_A
  const matched = params.search ? all.filter((f) => f.displayName.includes(params.search!)) : all
  const offset = Number(params.offset ?? 0)
  const limit = Number(params.limit ?? 20)
  return {
    success: true as const,
    data: { items: matched.slice(offset, offset + limit), total: matched.length },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  pushed.length = 0
  account.id = 'account-a'
  account.name = '本店'
  friendsList.mockImplementation(async (params: Parameters<typeof friendPage>[0]) => friendPage(params))
  // 作るたびに違うIDを返す。切替の前後で同じIDだと、別店の登録を
  // 更新してしまっても気づけない。
  let createdAffiliates = 0
  let createdOffers = 0
  affiliatesCreate.mockImplementation(async () => {
    createdAffiliates += 1
    return { success: true, data: { id: `affiliate-${createdAffiliates}` } }
  })
  affiliatesUpdate.mockImplementation(async (id: string) => ({ success: true, data: { id } }))
  offersCreate.mockImplementation(async () => {
    createdOffers += 1
    return { success: true, data: { id: `offer-${createdOffers}` } }
  })
  offersUpdate.mockImplementation(async (id: string) => ({ success: true, data: { id } }))
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
})

/* ------------------------------------------------------------------------ */

describe('アフィリエイター登録の実操作（#686）', () => {
  it('友だちを20件ずつ出し、2ページ目は21件目から取り、検索は選択中アカウントへ固定する', async () => {
    await mount(<NewAffiliatePage />)

    // 1ページ目は20件（＋「結びつけない」の空欄）。45件を全部は出さない。
    const select = byLabel<HTMLSelectElement>('LINEの友だちと結びつける')
    expect(select.options.length).toBe(21)
    expect(hasText('全45件')).toBe(true)

    // 検索は選択中のLINEアカウントへ固定して投げている。
    expect(friendsList).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'account-a', limit: 20, offset: '0' }),
    )

    // 2ページ目は21件目から。
    await choose(byId<HTMLSelectElement>('af-friend-page'), '2')
    expect(friendsList).toHaveBeenLastCalledWith(
      expect.objectContaining({ accountId: 'account-a', offset: '20' }),
    )
    expect(hasText('本店の友だち21')).toBe(true)

    // 名前で絞り込む。
    await type(byLabel<HTMLInputElement>('友だちの名前で検索'), '本店の友だち25')
    await click(buttonByText('検索'))
    expect(friendsList).toHaveBeenLastCalledWith(
      expect.objectContaining({ accountId: 'account-a', search: '本店の友だち25', offset: '0' }),
    )
    expect(hasText('本店の友だち25')).toBe(true)
  })

  it('割合0%を未入力と区別して、0のまま保存する', async () => {
    await mount(<NewAffiliatePage />)

    await type(byId<HTMLInputElement>('af-name'), '紹介パートナー')
    await click(buttonByText('売上に対する割合注文金額の◯%を報酬にします'))
    await type(byId<HTMLInputElement>('af-rate'), '0')
    await click(buttonByText('登録して、紹介リンクを発行する'))

    expect(affiliatesCreate).toHaveBeenCalledTimes(1)
    expect(affiliatesCreate.mock.calls[0][0]).toMatchObject({
      name: '紹介パートナー',
      commissionRate: 0,
      lineAccountId: 'account-a',
    })
    // 操作UUIDが必ず載っている（応答喪失の再送を同じ登録へ回収するため）。
    expect(typeof affiliatesCreate.mock.calls[0][0].operationId).toBe('string')
    expect(affiliatesCreate.mock.calls[0][0].operationId.length).toBeGreaterThan(8)
  })

  it('追加情報の保存だけ失敗しても、押し直しで紹介者を増やさず、直した名前も保存する', async () => {
    affiliatesUpdate.mockRejectedValueOnce(new Error('一時的に保存できません'))
    await mount(<NewAffiliatePage />)

    await type(byId<HTMLInputElement>('af-name'), '最初の名前')
    await click(buttonByText('登録して、紹介リンクを発行する'))

    // 基本情報は保存済み・追加情報は未保存、と画面に出る。
    expect(affiliatesCreate).toHaveBeenCalledTimes(1)
    expect(hasText('基本情報は保存済みです')).toBe(true)
    expect(pushed).toHaveLength(0)

    // ここで名前を直してから再開する。
    await type(byId<HTMLInputElement>('af-name'), '直した名前')
    await click(buttonByText('追加情報の保存を再開する'))

    // 紹介者は増えない。
    expect(affiliatesCreate).toHaveBeenCalledTimes(1)
    // 再開の保存に、直した名前が載っている（一部項目だけだと消える）。
    expect(affiliatesUpdate).toHaveBeenCalledTimes(2)
    expect(affiliatesUpdate.mock.calls[1][0]).toBe('affiliate-1')
    expect(affiliatesUpdate.mock.calls[1][1]).toMatchObject({ name: '直した名前' })
    expect(pushed[0]).toContain('highlight=affiliate-1')
  })

  it('途中保存のあとでLINEアカウントを切り替えたら、前の店の登録を更新しない', async () => {
    affiliatesUpdate.mockRejectedValueOnce(new Error('一時的に保存できません'))
    await mount(<NewAffiliatePage />)

    await type(byId<HTMLInputElement>('af-name'), 'A店のパートナー')
    await click(buttonByText('登録して、紹介リンクを発行する'))
    expect(hasText('基本情報は保存済みです')).toBe(true)
    const operationA = affiliatesCreate.mock.calls[0][0].operationId

    // ヘッダで別店へ切り替える。切替前の呼び出しと混ざらないよう境目を控える。
    const updatesBeforeSwitch = affiliatesUpdate.mock.calls.length
    account.id = 'account-b'
    account.name = '別店'
    await rerender(<NewAffiliatePage />)

    // 作りかけは捨てられ、「再開する」ボタンは消えている。
    expect(hasText('基本情報は保存済みです')).toBe(false)
    expect(buttonByText('登録して、紹介リンクを発行する')).toBeTruthy()

    await type(byId<HTMLInputElement>('af-name'), 'B店のパートナー')
    await click(buttonByText('登録して、紹介リンクを発行する'))

    // 切替のあと、A店の紹介者(affiliate-1)へ PUT していない。
    // 新しく B店へ作りに行っている。
    expect(affiliatesUpdate.mock.calls.slice(updatesBeforeSwitch).map((call) => call[0]))
      .not.toContain('affiliate-1')
    expect(affiliatesCreate).toHaveBeenCalledTimes(2)
    expect(affiliatesCreate.mock.calls[1][0]).toMatchObject({
      name: 'B店のパートナー',
      lineAccountId: 'account-b',
    })
    // 操作UUIDも作り直す。使い回すと、切替前の登録を回収してしまう。
    expect(affiliatesCreate.mock.calls[1][0].operationId).not.toBe(operationA)
  })
})

describe('案件登録の実操作（#686）', () => {
  it('小数の報酬額を日本語で止め、送信しない', async () => {
    await mount(<NewAffiliateOfferPage />)

    await type(byId<HTMLInputElement>('of-name'), '秋の紹介キャンペーン')
    await type(byId<HTMLInputElement>('of-amount'), '1.5')
    await click(buttonByText('公開する'))

    expect(hasText('報酬額は小数ではなく、1円単位の整数で入力してください')).toBe(true)
    expect(offersCreate).not.toHaveBeenCalled()
  })

  it('下書きへの変更だけ失敗しても、押し直しで案件を増やさず、直した内容も保存する', async () => {
    offersUpdate.mockRejectedValueOnce(new Error('一時的に保存できません'))
    await mount(<NewAffiliateOfferPage />)

    await type(byId<HTMLInputElement>('of-name'), '最初の案件名')
    await type(byId<HTMLInputElement>('of-amount'), '100')
    await click(container.querySelector<HTMLInputElement>('input[type="checkbox"]:checked')!)
    await click(buttonByText('下書きに保存'))

    expect(offersCreate).toHaveBeenCalledTimes(1)
    expect(offersCreate.mock.calls[0][0]).toMatchObject({ lineAccountId: 'account-a' })
    expect(typeof offersCreate.mock.calls[0][0].operationId).toBe('string')
    expect(hasText('案件は公開済みです')).toBe(true)

    await type(byId<HTMLInputElement>('of-name'), '直した案件名')
    await click(buttonByText('下書きへの変更を再開する'))

    expect(offersCreate).toHaveBeenCalledTimes(1)
    expect(offersUpdate).toHaveBeenCalledTimes(2)
    expect(offersUpdate.mock.calls[1][0]).toBe('offer-1')
    // isActive だけでなく、直した名前・報酬額も一緒に送る。
    expect(offersUpdate.mock.calls[1][1]).toMatchObject({
      name: '直した案件名',
      rewardAmount: 100,
      isActive: false,
    })
  })

  it('途中保存のあとでLINEアカウントを切り替えたら、前の店の案件を更新しない', async () => {
    offersUpdate.mockRejectedValueOnce(new Error('一時的に保存できません'))
    await mount(<NewAffiliateOfferPage />)

    await type(byId<HTMLInputElement>('of-name'), 'A店の案件')
    await type(byId<HTMLInputElement>('of-amount'), '100')
    await click(container.querySelector<HTMLInputElement>('input[type="checkbox"]:checked')!)
    await click(buttonByText('下書きに保存'))
    expect(hasText('案件は公開済みです')).toBe(true)
    const operationA = offersCreate.mock.calls[0][0].operationId

    const offerUpdatesBeforeSwitch = offersUpdate.mock.calls.length
    account.id = 'account-b'
    account.name = '別店'
    await rerender(<NewAffiliateOfferPage />)

    expect(hasText('案件は公開済みです')).toBe(false)
    // 誘導先の表示も切り替わった店になっている。
    expect(hasText('別店')).toBe(true)

    // 下書きにするかどうかは店に紐づく選択ではないので、切替後もそのまま残る。
    await type(byId<HTMLInputElement>('of-name'), 'B店の案件')
    await type(byId<HTMLInputElement>('of-amount'), '200')
    await click(buttonByText('下書きに保存'))

    // 切替のあと、A店の案件(offer-1)へ PUT していない。
    expect(offersUpdate.mock.calls.slice(offerUpdatesBeforeSwitch).map((call) => call[0]))
      .not.toContain('offer-1')
    expect(offersCreate).toHaveBeenCalledTimes(2)
    expect(offersCreate.mock.calls[1][0]).toMatchObject({
      name: 'B店の案件',
      lineAccountId: 'account-b',
    })
    expect(offersCreate.mock.calls[1][0].operationId).not.toBe(operationA)
  })
})
