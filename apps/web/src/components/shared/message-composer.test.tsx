// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BroadcastBubble } from '@line-crm/shared'
vi.mock('@/components/scenarios/insert-toolbar', () => ({ default: () => null }))
vi.mock('@/components/scenarios/message-kind-fields', () => ({ default: () => null, emptyMessageKindState: () => ({}) }))
vi.mock('./message-composer-media', () => ({ default: () => null }))
import Composer, { ComposerCarouselPreview } from './message-composer'
import { HqInsertRow, insertHqToken } from './hq-message-inserts'
afterEach(cleanup)
const make = (id: string): BroadcastBubble => ({ id, type: 'text', content: { text: id } })
function Harness({ count = 2, hq = false }: { count?: number; hq?: boolean }) {
  const [bubbles, setBubbles] = useState(Array.from({ length: count }, (_, i) => make(`本文${i + 1}`)))
  return <Composer bubbles={bubbles} accountId={null} inserts={hq ? (ref, value, change) => <HqInsertRow count={value.length} onInsert={token => insertHqToken(ref, value, change, token)} /> : undefined} unavailable={{ intro: '準備中です' }} onChange={(index, next) => setBubbles(items => items.map((item, i) => i === index ? next : item))} onMove={(index, direction) => setBubbles(items => { const next = [...items]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next })} onDelete={index => setBubbles(items => items.filter((_, i) => i !== index))} onAdd={() => setBubbles(items => [...items, make('新しい本文')])} onPickTemplate={() => {}} onSaveTemplate={() => {}} onCompose={() => {}} />
}
describe('共通メッセージ composer', () => {
  it('統括の差し込みは1行と1つの文字数を持ち、選んだ本文へ挿入する', () => {
    const { container } = render(<Harness count={1} hq />)
    expect(container.querySelectorAll('[data-message-insert-row]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-message-character-count]')).toHaveLength(1)
    expect(screen.getAllByText('差し込む')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '店名', exact: true }))
    expect((screen.getByLabelText('本文') as HTMLTextAreaElement).value).toContain('{{account.name}}')
  })

  it('カルーセルの見本は実際の全カードとボタンを表示し、壊れたJSONは送信内容と混ぜない', () => {
    const content = { columnsJson: JSON.stringify([{ title: '商品A', actions: [{ label: '購入する' }] }, { title: '商品B', actions: [{ label: '予約する' }] }, { title: '商品C', actions: [{ label: '詳細を見る' }] }]) }
    const { rerender } = render(<ComposerCarouselPreview bubble={{ id: 'c', type: 'carousel', content }} />)
    expect(screen.getByText('商品C')).toBeTruthy(); expect(screen.getByText('予約する')).toBeTruthy()
    rerender(<ComposerCarouselPreview bubble={{ id: 'c', type: 'carousel', content: { columnsJson: '{壊れたJSON' } }} />)
    expect(screen.queryByText('商品A')).toBeNull(); expect(screen.getByText('カードを作ると表示されます')).toBeTruthy()
  })

  it('作成済みカルーセルの縮小見本は省略しても元のタイトルを確認でき、編集するカードを保つ', () => {
    const title = 'お試しセットを初めて購入する方へのご案内'
    const onCompose = vi.fn()
    render(<Composer bubbles={[{ id: 'carousel-1', type: 'carousel', content: { templateName: '秋の商品', columnsJson: JSON.stringify([{ title, thumbnailImageUrl: 'https://example.test/image.png' }]), inline: true } }]} accountId={null} onChange={() => {}} onMove={() => {}} onDelete={() => {}} onAdd={() => {}} onPickTemplate={() => {}} onSaveTemplate={() => {}} onCompose={onCompose} />)
    const text = screen.getByTitle(title)
    expect(text.hasAttribute('data-truncated-text')).toBe(true)
    expect(text.textContent).toBe(title)
    fireEvent.click(screen.getByRole('button', { name: '開いて直す' }))
    expect(onCompose).toHaveBeenCalledWith(0, 'carousel')
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
