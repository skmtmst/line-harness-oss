// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TableBody } from './table-body'

let top = 0
let callbacks: Array<ResizeObserverCallback> = []
const keys = (item: number) => `row-${item}`
const row = (item: number) => <tr data-friend-row><td><button>{`行${item}`}</button></td></tr>
const items = Array.from({ length: 2000 }, (_, index) => index)
const setup = () => {
  top = 0
  callbacks = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { callbacks.push(callback) }
    observe() {}
    disconnect() {}
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { top: this.tagName === 'TBODY' ? top : 0, bottom: 900, height: this.tagName === 'TR' ? 59 : 900, width: 100 } as DOMRect
  })
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('2,000件を保持し、見える行だけを呼び出す。最後へのスクロールと選択も動く', async () => {
  setup()
  const renderRow = vi.fn(row)
  const { container } = render(<table><TableBody items={items} itemKey={keys} colSpan={1} renderRow={renderRow} /></table>)
  expect(screen.getByText('行0')).toBeTruthy()
  expect(screen.queryByText('行1999')).toBeNull()
  expect(renderRow.mock.calls.length).toBeLessThan(60)
  expect(container.querySelector('tbody')?.dataset.rowCount).toBe('2000')
  top = -1990 * 58
  fireEvent.scroll(window)
  await waitFor(() => expect(screen.getByText('行1999')).toBeTruthy())
  expect(container.querySelectorAll('[data-friend-row]').length).toBeLessThan(60)
  const select = vi.fn()
  screen.getByText('行1999').onclick = select
  fireEvent.click(screen.getByText('行1999'))
  expect(select).toHaveBeenCalledOnce()
})

it('遠くへ送ってもフォーカス行と開いたメニューを残し、間の1,900行は描かない', async () => {
  setup()
  const { container } = render(<table><TableBody items={items} itemKey={keys} colSpan={1} renderRow={row} /></table>)
  screen.getByText('行1').focus()
  screen.getByText('行3').setAttribute('aria-expanded', 'true')
  top = -1900 * 58
  fireEvent.scroll(window)
  await waitFor(() => expect(screen.getByText('行1900')).toBeTruthy())
  expect(document.activeElement).toBe(screen.getByText('行1'))
  expect(screen.getByText('行3')).toBeTruthy()
  expect(container.querySelectorAll('[data-friend-row]').length).toBeLessThan(60)
})

it('実測した59pxへ詰め物の高さを合わせる。少数・空・更新では元の表を保つ', async () => {
  setup()
  const { container, rerender } = render(<table><TableBody items={items} itemKey={keys} colSpan={1} renderRow={row} /></table>)
  act(() => {
    callbacks.at(-1)?.([...container.querySelectorAll('[data-table-index]')].map((target) => ({ target })) as ResizeObserverEntry[], {} as ResizeObserver)
  })
  await waitFor(() => {
    const cells = [...container.querySelectorAll('tbody > tr > td')]
    const spacerHeight = cells.reduce((sum, cell) => sum + Number((cell as HTMLElement).style.height.replace('px', '') || 0), 0)
    expect(spacerHeight + container.querySelectorAll('[data-table-index]').length * 59).toBe(2000 * 59)
  })
  rerender(<table><TableBody items={[1, 2]} itemKey={keys} colSpan={1} renderRow={row} /></table>)
  expect(container.querySelector('[data-virtual-table]')).toBeNull()
  expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
  rerender(<table><TableBody items={[]} itemKey={keys} colSpan={1} renderRow={row}><tr><td>読み込み失敗</td></tr></TableBody></table>)
  expect(screen.getByText('読み込み失敗')).toBeTruthy()
})

it('狭い幅で補助列を畳んだら、詰め物の列数も減らして名前の列を潰さない', () => {
  setup()
  const { container } = render(<table><TableBody items={items} itemKey={keys} colSpan={3} renderRow={(item) => <tr>
    <td>名前{item}</td><td style={{ display: 'none' }}>補助</td><td><button>操作</button></td>
  </tr>} /></table>)
  const spacer = container.querySelector('tr[aria-hidden="true"] td') as HTMLTableCellElement
  expect(spacer.colSpan).toBe(2)
})

it('高さや窓だけが変わっても残る行を作り直さず、データ・選択の更新は描く', async () => {
  setup()
  const select = vi.fn()
  const renderRow = vi.fn((item: number) => <tr><td><button onClick={() => select(item)}>名前{item}</button></td></tr>)
  const { container, rerender } = render(<table><TableBody items={items} itemKey={keys} colSpan={1} renderRow={renderRow} /></table>)
  const first = screen.getByText('名前0')
  expect(renderRow.mock.calls.filter(([item]) => item === 0)).toHaveLength(1)
  act(() => {
    callbacks.at(-1)?.([...container.querySelectorAll('[data-table-index]')].map(target => ({ target })) as ResizeObserverEntry[], {} as ResizeObserver)
  })
  await waitFor(() => {
    const spacers = [...container.querySelectorAll('tr[aria-hidden="true"] td')].reduce((sum, cell) => sum + Number((cell as HTMLElement).style.height.replace('px', '')), 0)
    expect(spacers + container.querySelectorAll('[data-table-index]').length * 59).toBe(118000)
  })
  expect(screen.getByText('名前0')).toBe(first)
  expect(renderRow.mock.calls.filter(([item]) => item === 0)).toHaveLength(1)
  fireEvent.click(first)
  expect(select).toHaveBeenCalledWith(0)
  const updated = vi.fn((item: number) => <tr aria-selected={item === 0}><td><button onClick={() => select(item + 1)}>更新{item}</button></td></tr>)
  rerender(<table><TableBody items={items} itemKey={keys} colSpan={1} renderRow={updated} /></table>)
  expect(screen.getByText('更新0').closest('tr')?.getAttribute('aria-selected')).toBe('true')
  fireEvent.click(screen.getByText('更新0'))
  expect(select).toHaveBeenLastCalledWith(1)
})
