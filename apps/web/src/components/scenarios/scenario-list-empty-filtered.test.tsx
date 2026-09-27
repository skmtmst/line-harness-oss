// @vitest-environment happy-dom
/*
 * R173: 絞り込み0件をデータ未作成の状態として案内しない。
 *
 * 元データ0件と検索結果0件を分け、後者には「条件に合うものが
 * ありません」と「条件をクリア」ボタンを出す（共通 ListState の
 * `filtered`）。作る口を出すと保存済みが消えたと誤読される。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string } & Record<string, unknown>) =>
    React.createElement('a', { href, ...rest }, children),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

import ScenarioList from './scenario-list'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function mount(props: Partial<React.ComponentProps<typeof ScenarioList>> = {}) {
  await act(async () => {
    root.render(
      <ScenarioList
        scenarios={[]}
        onToggleActive={vi.fn()}
        onDelete={vi.fn()}
        {...props}
      />,
    )
  })
}

describe('R173 シナリオ一覧の0件の出し分け', () => {
  it('絞り込んでいない0件は「まだありません」と作る口を出す', async () => {
    await mount({ onCreate: vi.fn() })
    expect(host.textContent).toContain('まだシナリオがありません')
    expect(host.textContent).toContain('シナリオを作る')
    expect(host.textContent).not.toContain('条件に合うものがありません')
  })

  it('絞り込みの結果0件は「条件に合うものがありません」と条件クリアを出す', async () => {
    const onClearFilter = vi.fn()
    await mount({ isFiltered: true, onClearFilter, onCreate: vi.fn() })
    expect(host.textContent).toContain('条件に合うものがありません')
    expect(host.textContent).not.toContain('まだシナリオがありません')
    // 作る口は出さない。保存済みが消えたと誤読される。
    expect(host.textContent).not.toContain('シナリオを作る')
    const clear = [...host.querySelectorAll('button')].find((el) =>
      el.textContent?.includes('条件をクリア'),
    ) as HTMLButtonElement
    expect(clear, '条件をクリアボタンが見つかりません').toBeTruthy()
    act(() => { clear.click() })
    expect(onClearFilter).toHaveBeenCalledTimes(1)
  })
})
