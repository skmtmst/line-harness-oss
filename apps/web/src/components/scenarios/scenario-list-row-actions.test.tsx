// @vitest-environment happy-dom
/*
 * #641: 一覧の操作列を「枠つき編集ボタン＋・・・」へ統一。
 * シナリオ一覧が文字リンクの「編集」をやめ、友だち追加時配信と
 * 同じ枠つきボタン＋その他メニューの形になったことを実マウントで確かめる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string } & Record<string, unknown>) =>
    React.createElement('a', { href, ...rest }, children),
}))

import ScenarioList from './scenario-list'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Row = React.ComponentProps<typeof ScenarioList>['scenarios'][number]

function scenario(partial: Partial<Row>): Row {
  return {
    id: 'sc-1',
    name: '予約前のお知らせ',
    description: null,
    isActive: true,
    folderId: null,
    lineAccountId: 'account-a',
    deliveryMode: 'elapsed',
    stepCount: 2,
    subscriberCount: 3,
    completedCount: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  } as unknown as Row
}

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

async function mount(scenarios: Row[]) {
  await act(async () => {
    root.render(
      <ScenarioList
        scenarios={scenarios}
        onToggleActive={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
  })
}

describe('#641 シナリオ一覧の行操作', () => {
  it('「編集」が文字リンクではなく枠つきボタン（共通Button）で出る', async () => {
    await mount([scenario({})])
    const links = [...host.querySelectorAll('a[href="/scenarios/detail?id=sc-1"]')]
    const edit = links.find((el) => el.textContent?.includes('編集'))
    expect(edit, '編集ボタンが見つかりません').toBeTruthy()
    // 文字リンク時代のクラス（text-accent + 裸のリンク）ではなく共通ボタンの枠。
    expect(edit!.className).not.toContain('text-accent')
    expect(edit!.textContent).toContain('編集')
  })

  it('「・・・」ボタンがあって、押すとメニュー（停止・削除）が開く', async () => {
    await mount([scenario({})])
    const more = host.querySelector('button[aria-label="予約前のお知らせのその他操作"]') as HTMLButtonElement
    expect(more, 'その他ボタンが見つかりません').toBeTruthy()
    act(() => { more.click() })
    const menu = host.querySelector('[role="menu"]')
    expect(menu, 'メニューが開きません').toBeTruthy()
    expect(menu!.textContent).toContain('停止する')
    expect(menu!.textContent).toContain('削除する')
  })

  it('止めている行の「・・・」には撮影口（RUxNf）が残る', async () => {
    await mount([scenario({ isActive: false })])
    const more = host.querySelector('button[data-qa-open="RUxNf"]')
    expect(more, '停止行の撮影口が消えています').toBeTruthy()
  })
})
