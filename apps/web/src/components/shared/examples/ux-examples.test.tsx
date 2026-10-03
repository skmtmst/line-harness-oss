// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import BroadcastListExample from './broadcast-list-example'
import DashboardTilesExample from './dashboard-tiles-example'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

const rows = [
  { id: 'b1', title: '春の案内', status: '公開中', sentAt: '2026-10-01' },
  { id: 'b2', title: '夏の案内', status: '下書き', sentAt: '2026-10-02' },
]

describe('使い方の例（一斉配信の一覧・C①③）', () => {
  it('行を押すと詳細パネルが開き、URL に行が残る', () => {
    render(<BroadcastListExample rows={rows} />)
    fireEvent.click(screen.getByRole('button', { name: '春の案内' }))
    expect(screen.getByRole('dialog')).not.toBeNull()
    expect(window.location.search).toContain('row=b1')
  })

  it('右クリックで操作メニューが出る', () => {
    render(<BroadcastListExample rows={rows} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: '夏の案内' }), { clientX: 100, clientY: 100 })
    expect(screen.getByRole('menu', { name: '夏の案内の操作' })).not.toBeNull()
  })
})

describe('使い方の例（ダッシュボードの数のタイル・D・E⑤）', () => {
  it('読み込み中はタイルの形のスケルトン', () => {
    const { container } = render(<DashboardTilesExample tiles={[]} loading />)
    // 骨組み自体は読み上げない（入れ物の aria-busy は画面側）。形だけ確かめる。
    expect(container.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0)
  })

  it('タイルを押すと内訳が切り替わる', () => {
    render(
      <DashboardTilesExample
        loading={false}
        tiles={[
          { id: 't1', label: '友だち', display: '実データ' },
          { id: 't2', label: '予約', display: '実データ' },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /予約/ }))
    expect(screen.getByText('予約の内訳を表示')).not.toBeNull()
  })
})
