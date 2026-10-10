// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BroadcastBubble } from '@line-crm/shared'
vi.mock('@/components/scenarios/insert-toolbar', () => ({ default: () => null }))
vi.mock('@/components/scenarios/message-kind-fields', () => ({ default: () => null, emptyMessageKindState: () => ({}) }))
vi.mock('./message-composer-media', () => ({ default: () => null }))
vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => 'v8' }))
import Composer, { ComposerCarouselPreview } from './message-composer'
afterEach(cleanup)
const make = (id: string): BroadcastBubble => ({ id, type: 'text', content: { text: id } })
function Harness({ count = 2 }: { count?: number }) {
  const [bubbles, setBubbles] = useState(Array.from({ length: count }, (_, i) => make(`本文${i + 1}`)))
  return <Composer bubbles={bubbles} accountId={null} unavailable={{ intro: '準備中です' }} onChange={(index, next) => setBubbles(items => items.map((item, i) => i === index ? next : item))} onMove={(index, direction) => setBubbles(items => { const next = [...items]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next })} onDelete={index => setBubbles(items => items.filter((_, i) => i !== index))} onAdd={() => setBubbles(items => [...items, make('新しい本文')])} onPickTemplate={() => {}} onSaveTemplate={() => {}} onCompose={() => {}} />
}
describe('共通メッセージ composer', () => {
  it('カルーセルの見本は実際の全カードとボタンを表示し、壊れたJSONは送信内容と混ぜない', () => {
    const content = { columnsJson: JSON.stringify([{ title: '商品A', actions: [{ label: '購入する' }] }, { title: '商品B', actions: [{ label: '予約する' }] }, { title: '商品C', actions: [{ label: '詳細を見る' }] }]) }
    const { rerender } = render(<ComposerCarouselPreview bubble={{ id: 'c', type: 'carousel', content }} />)
    expect(screen.getByText('商品C')).toBeTruthy(); expect(screen.getByText('予約する')).toBeTruthy()
    rerender(<ComposerCarouselPreview bubble={{ id: 'c', type: 'carousel', content: { columnsJson: '{壊れたJSON' } }} />)
    expect(screen.queryByText('商品A')).toBeNull(); expect(screen.getByText('カードを作ると表示されます')).toBeTruthy()
  })

  it('上下移動・削除で本文と吹き出しの組を保ち、最後の1通は残す', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '1通目を下へ移動' }))
    expect((screen.getByLabelText('本文') as HTMLTextAreaElement).value).toBe('本文2')
    expect((screen.getByLabelText('2通目の本文') as HTMLTextAreaElement).value).toBe('本文1')
    fireEvent.click(screen.getByRole('button', { name: '2通目を削除する' }))
    expect(screen.queryByLabelText('2通目の本文')).toBeNull()
    expect((screen.getByRole('button', { name: '1通目を削除する' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('5通で追加を止め、理由を表示する', () => {
    render(<Harness count={5} />)
    const add = screen.getByRole('button', { name: 'メッセージを追加する' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    expect(screen.getByText('1回の配信は5つまでです')).toBeTruthy()
    fireEvent.click(add)
    expect(screen.getAllByRole('tablist')).toHaveLength(5)
  })
  it('矢印はフォーカスだけを移し、使えない種類を押しても本文を残す', () => {
    render(<Harness count={1} />)
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab')
    tabs[0].focus(); fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabs[1])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    const intro = screen.getByRole('tab', { name: '紹介' })
    expect(intro.getAttribute('title')).toBe('準備中です')
    fireEvent.click(intro)
    expect((screen.getByLabelText('本文') as HTMLTextAreaElement).value).toBe('本文1')
  })
})
