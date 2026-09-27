// @vitest-environment happy-dom
/*
 * R174: 店舗追加の入力欄4つに読み上げ用の項目名がない。
 *
 * 店舗名・略称・チャネルID・チャネルシークレットが見た目の見出しと
 * 結び付いておらず、名前のない textbox として露出していた。各入力に
 * id を付け label を対応させ、補足とエラーも aria-describedby で結ぶ
 * （WCAG 3.3.2・1.3.1）。ラベルを選ぶと該当入力へ移動できる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string } & Record<string, unknown>) =>
    React.createElement('a', { href, ...rest }, children),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a' }),
}))
vi.mock('@/lib/restaurant-test-api', () => ({
  restaurantTestApi: {
    termsAgreement: vi.fn(),
    agreeToTerms: vi.fn(),
    connectStore: vi.fn(),
    selectStore: vi.fn(),
  },
}))

import { TERMS_DOCUMENT } from '@/content/terms/musubo-terms'
import { restaurantTestApi } from '@/lib/restaurant-test-api'
import NewRestaurantStorePage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  // 規約は同意済みにして、基本情報の手順から始める。
  vi.mocked(restaurantTestApi.termsAgreement).mockResolvedValue({
    success: true,
    data: { agreedVersion: TERMS_DOCUMENT.version, agreedAt: null },
  } as never)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function mount() {
  await act(async () => {
    root.render(<NewRestaurantStorePage />)
  })
}

function inputByName(name: RegExp): HTMLInputElement {
  const labels = [...host.querySelectorAll('label')].filter((el) =>
    name.test(el.textContent ?? ''),
  )
  expect(labels.length, `${name} のラベルが見つかりません`).toBe(1)
  const control = labels[0]!.control as HTMLInputElement | null
  expect(control, `${name} のラベルと入力が結び付いていません`).toBeTruthy()
  return control!
}

describe('R174 店舗追加の入力欄の項目名', () => {
  it('店舗名と略称に読み上げ用の項目名があり、ラベルで移動できる', async () => {
    await mount()
    const name = inputByName(/店舗名/)
    const alias = inputByName(/略称/)
    // 補足の文へ結ぶ（いつ時点・何を入れるかの説明は欄からたどれる）。
    expect(name.getAttribute('aria-describedby')).toContain('-help')
    expect(alias.getAttribute('aria-describedby')).toContain('-help')
    // ラベルを選ぶと該当入力へ移動できる（`htmlFor` と `id` の結び付け。
    // happy-dom は label クリックのフォーカス移動を再現しないため、
    // ブラウザが移動に使う結び付け自体を見る。`inputByName` ですでに
    // `label.control` の解決も確かめている）。
    const nameLabel = [...host.querySelectorAll('label')].find((el) =>
      /店舗名/.test(el.textContent ?? ''),
    )! as HTMLLabelElement
    expect(name.id).not.toBe('')
    expect(nameLabel.htmlFor).toBe(name.id)
  })

  it('チャネルIDとチャネルシークレットにも項目名がある', async () => {
    await mount()
    // 基本情報 → 次へ。
    const name = inputByName(/店舗名/)
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(name, 'テスト店舗')
      name.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    // React の非制御に見える入力へ change を届ける（input だけでは state が動かない場合に備える）。
    await act(async () => {
      name.dispatchEvent(new window.Event('change', { bubbles: true }))
    })
    const nextBasics = [...host.querySelectorAll('button')].find((el) =>
      el.textContent === '次へ',
    ) as HTMLButtonElement
    await act(async () => {
      nextBasics.click()
    })
    // 公式アカウントの用意 → チェック → 次へ。
    const ready = host.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(ready, '公式アカウントのチェックが見つかりません').toBeTruthy()
    await act(async () => {
      ready.click()
    })
    const nextOfficial = [...host.querySelectorAll('button')].find((el) =>
      el.textContent === '次へ',
    ) as HTMLButtonElement
    await act(async () => {
      nextOfficial.click()
    })
    const channelId = inputByName(/チャネルID/)
    const secret = inputByName(/チャネルシークレット/)
    expect(channelId.getAttribute('aria-describedby')).toContain('-help')
    expect(secret.getAttribute('aria-describedby')).toContain('-help')
    expect(channelId.getAttribute('type')).not.toBe('hidden')
  })
})
