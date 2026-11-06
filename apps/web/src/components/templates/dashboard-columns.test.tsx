// @vitest-environment happy-dom
import { Fragment, useEffect, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DashboardColumns } from './dashboard-page'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function EditableCard({ id }: { id: string }) {
  const [value, setValue] = useState('')
  useEffect(() => { void fetch(`/api/dashboard/${id}`) }, [id])
  return <input aria-label={id} value={value} onChange={(event) => setValue(event.target.value)} />
}

function cards(ids: string[]) {
  return ids.map((id) => <Fragment key={id}><EditableCard id={id} /></Fragment>)
}

function unkeyedCard(id: string) {
  return <EditableCard id={id} />
}

function mockReads() {
  const reads = vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify({ url }))))
  vi.stubGlobal('fetch', reads)
  return reads
}

describe('DashboardColumns child identity', () => {
  it.each([
    ['先頭へ追加', ['upcoming', 'delivery-failure-origins', 'recent']],
    ['同じ行の並べ替え', ['recent', 'delivery-failure-origins']],
  ])('%sでも既存カードの通信と入力を保つ', (_, ids) => {
    const reads = mockReads()
    const { rerender } = render(<DashboardColumns>{cards(['delivery-failure-origins', 'recent'])}</DashboardColumns>)
    const input = screen.getByRole('textbox', { name: 'delivery-failure-origins' })
    fireEvent.change(input, { target: { value: '入力中' } })

    rerender(<DashboardColumns>{cards(ids)}</DashboardColumns>)

    expect(reads.mock.calls.filter(([url]) => url === '/api/dashboard/delivery-failure-origins')).toHaveLength(1)
    expect(reads.mock.calls.filter(([url]) => url === '/api/dashboard/recent')).toHaveLength(1)
    expect(reads).toHaveBeenCalledTimes(ids.length)
    expect(screen.getByRole('textbox', { name: 'delivery-failure-origins' })).toBe(input)
    expect((input as HTMLInputElement).value).toBe('入力中')
  })

  it('null/false/undefinedの空セルも残し、keyなしの同じ位置は再利用する', () => {
    mockReads()
    const children = [null, false, undefined, unkeyedCard('plain')]
    const { container, rerender } = render(<DashboardColumns>{children}</DashboardColumns>)
    const row = container.firstElementChild!
    const input = screen.getByRole('textbox', { name: 'plain' })
    fireEvent.change(input, { target: { value: '保持' } })
    expect(row.children).toHaveLength(4)
    expect([...row.children].slice(0, 3).map((cell) => cell.childNodes.length)).toEqual([0, 0, 0])

    rerender(<DashboardColumns>{[null, false, undefined, unkeyedCard('plain')]}</DashboardColumns>)
    expect(screen.getByRole('textbox', { name: 'plain' })).toBe(input)
    expect((input as HTMLInputElement).value).toBe('保持')
  })

  it('数字の明示keyが別のkeyなしセルの位置と衝突しない', () => {
    const reads = mockReads()
    const { rerender } = render(<DashboardColumns>{[
      <EditableCard key="1" id="keyed" />, unkeyedCard('plain'),
    ]}</DashboardColumns>)
    const input = screen.getByRole('textbox', { name: 'keyed' })
    fireEvent.change(input, { target: { value: '保持' } })
    rerender(<DashboardColumns>{[
      <p key="new">追加</p>, <EditableCard key="1" id="keyed" />, unkeyedCard('plain'),
    ]}</DashboardColumns>)
    expect(screen.getByRole('textbox', { name: 'keyed' })).toBe(input)
    expect((input as HTMLInputElement).value).toBe('保持')
    expect(reads.mock.calls.filter(([url]) => url === '/api/dashboard/keyed')).toHaveLength(1)
  })

  it('cards配置は空セルを作らず直接のカードとその状態を保つ', () => {
    const reads = mockReads()
    const { container, rerender } = render(<DashboardColumns layout="cards">{[
      null, false, <EditableCard key="a" id="a" />, <EditableCard key="b" id="b" />,
    ]}</DashboardColumns>)
    const row = container.firstElementChild!
    const input = screen.getByRole('textbox', { name: 'a' })
    fireEvent.change(input, { target: { value: '保持' } })
    expect([...row.children].map((child) => child.tagName)).toEqual(['INPUT', 'INPUT'])
    rerender(<DashboardColumns layout="cards">{[
      <EditableCard key="b" id="b" />, null, <EditableCard key="a" id="a" />,
    ]}</DashboardColumns>)
    expect(screen.getByRole('textbox', { name: 'a' })).toBe(input)
    expect((input as HTMLInputElement).value).toBe('保持')
    expect(reads).toHaveBeenCalledTimes(2)
  })
})
