// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CheckCard from './check-card'
import { DialogSteps } from './dialog'
import { LinePreviewCard } from './line-preview'

afterEach(cleanup)

describe('V8 cards の操作', () => {
  it('チェックのカードは本物の入力を使い、無効時は操作を受け付けない', () => {
    const change = vi.fn()
    const { rerender } = render(<CheckCard checked={false} onChange={change} title="対象を除く" />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(change).toHaveBeenCalledWith(true)
    change.mockClear()
    rerender(<CheckCard checked={false} disabled onChange={change} title="対象を除く" />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(change).not.toHaveBeenCalled()
  })

  it('手順は現在地を読み上げに伝え、済みの手順へ戻れる', () => {
    const back = vi.fn()
    render(<DialogSteps steps={[{ label: '人', done: true, onSelect: back }, { label: '役割', current: true }]} />)
    fireEvent.click(screen.getByRole('button', { name: '人' }))
    expect(back).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: /2.*役割/ }).getAttribute('aria-current')).toBe('step')
  })

  it('LINEの商品カードの操作を、渡された処理へ渡す', () => {
    const open = vi.fn(), add = vi.fn()
    render(<LinePreviewCard imageUrl="/sample.png" title="商品" description="説明" price="¥3,280" time="10:00" actions={[{ label: '商品を見る', onClick: open }, { label: '定期便に追加', onClick: add, secondary: true }]} />)
    fireEvent.click(screen.getByRole('button', { name: '商品を見る' }))
    fireEvent.click(screen.getByRole('button', { name: '定期便に追加' }))
    expect(open).toHaveBeenCalledOnce()
    expect(add).toHaveBeenCalledOnce()
  })
})
