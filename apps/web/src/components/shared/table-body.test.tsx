// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Profiler } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { TableBody } from './table-body'

let top = 0
let callbacks: Array<ResizeObserverCallback> = []
let observers: Array<{ observe: ReturnType<typeof vi.fn>; unobserve: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = []
const keys = (item: number) => `row-${item}`
const row = (item: number) => <tr data-friend-row><td><button>{`行${item}`}</button></td></tr>
const items = Array.from({ length: 2000 }, (_, index) => index)
const setup = () => {
  top = 0
  callbacks = []
  observers = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { callbacks.push(callback); observers.push(this) }
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { top: this.tagName === 'TBODY' ? top : 0, bottom: 900, height: this.tagName === 'TR' ? 59 : 900, width: 100 } as DOMRect
  })
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('同じ初回の実測と途中追加行では再計測を重ねず、実際の高さ・幅の変化では読み直す', async () => {
  setup()
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const { container } = render(<table><TableBody items={items} itemKey={keys} colSpan={2} renderRow={item => <tr>
    <td><button>{`行${item}`}</button></td><td>補助</td>
  </tr>} /></table>)
  await act(async () => {})
  const notify = async (target: Element, height: number, width: number) => {
    await act(async () => callbacks[0]?.([{ target, borderBoxSize: [{ blockSize: height, inlineSize: width }] }] as unknown as ResizeObserverEntry[], {} as ResizeObserver))
  }
  const flush = async () => { await act(async () => { for (const frame of frames.splice(0)) frame(0) }) }
  const first = container.querySelector('[data-table-index="0"]')!
  await notify(first, 58, 100)
  expect(frames).toHaveLength(0)
  await notify(first, 83, 100)
  expect(frames).toHaveLength(1)
  await flush()
  container.querySelectorAll<HTMLTableRowElement>('[data-table-index]').forEach(element => { element.cells[1].style.display = 'none' })
  await notify(first, 83, 90)
  expect(frames).toHaveLength(1)
  await flush()
  expect(container.querySelector<HTMLTableCellElement>('tr[aria-hidden="true"] td')?.colSpan).toBe(1)
  top = -1900 * 83
  fireEvent.scroll(window)
  await flush()
  const entered = container.querySelector('[data-table-index="1900"]')!
  expect(entered).toBeTruthy()
  await notify(entered, 83, 100)
  expect(frames).toHaveLength(0)
})

it('見積もりと同じ初回実測では表を再コミットせず、後の先頭行変更でも測定済みの高さを保つ', async () => {
  setup()
  const committed = vi.fn()
  const { container } = render(<table><Profiler id="table" onRender={committed}>
    <TableBody items={items} itemKey={keys} colSpan={1} renderRow={row} />
  </Profiler></table>)
  await waitFor(() => expect(container.querySelectorAll('[data-table-index]').length).toBeLessThan(20))
  const initial = [container.querySelector('[data-table-index="0"]')!, container.querySelector('[data-table-index="1"]')!]
  const before = committed.mock.calls.length
  act(() => callbacks[0]?.(initial.map(target => ({ target, borderBoxSize: [{ blockSize: 58, inlineSize: 100 }] })) as unknown as ResizeObserverEntry[], {} as ResizeObserver))
  expect(committed).toHaveBeenCalledTimes(before)

  // This row must stay at its real 58px when the first row changes the estimate.
  const first = container.querySelector('[data-table-index="0"]')!
  act(() => callbacks[0]?.([{ target: first, borderBoxSize: [{ blockSize: 83, inlineSize: 100 }] }] as unknown as ResizeObserverEntry[], {} as ResizeObserver))
  await waitFor(() => {
    const spacers = [...container.querySelectorAll<HTMLElement>('tr[aria-hidden="true"] td')].reduce((sum, cell) => sum + parseFloat(cell.style.height), 0)
    const mounted = [...container.querySelectorAll<HTMLElement>('[data-table-index]')].reduce((sum, element) => sum + (element.dataset.tableIndex === '1' ? 58 : 83), 0)
    expect(spacers + mounted).toBe(1999 * 83 + 58)
  })
  expect(committed.mock.calls.length).toBeGreaterThan(before)

  // Once row 1 leaves the window its measured height still belongs in the spacer.
  top = -1900 * 83
  fireEvent.scroll(window)
  await screen.findByText('行1900')
  const spacers = [...container.querySelectorAll<HTMLElement>('tr[aria-hidden="true"] td')].reduce((sum, cell) => sum + parseFloat(cell.style.height), 0)
  expect(spacers + container.querySelectorAll('[data-table-index]').length * 83).toBe(1999 * 83 + 58)
})

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

it('狭い幅で補助列を畳んだら、詰め物の列数も減らして名前の列を潰さない', async () => {
  setup()
  const { container } = render(<table><TableBody items={items} itemKey={keys} colSpan={3} renderRow={(item) => <tr>
    <td>名前{item}</td><td style={{ display: 'none' }}>補助</td><td><button>操作</button></td>
  </tr>} /></table>)
  await waitFor(() => expect(container.querySelector<HTMLTableCellElement>('tr[aria-hidden="true"] td')?.colSpan).toBe(2))
})

it('高さが同じ幅だけの実測変更でも、畳まれた列を読み直す', async () => {
  setup()
  const { container } = render(<table><TableBody items={items} itemKey={keys} colSpan={2} estimatedRowHeight={59} renderRow={(item) => <tr>
    <td>名前{item}</td><td>補助</td>
  </tr>} /></table>)
  await waitFor(() => expect(container.querySelectorAll('[data-table-index]').length).toBeLessThan(20))
  const first = container.querySelector<HTMLTableRowElement>('[data-table-index]')!
  const notify = (width: number) => act(() => callbacks[0]?.([{ target: first, borderBoxSize: [{ blockSize: 59, inlineSize: width }] }] as unknown as ResizeObserverEntry[], {} as ResizeObserver))
  notify(100)
  first.cells[1].style.display = 'none'
  notify(60)
  await waitFor(() => expect(container.querySelector<HTMLTableCellElement>('tr[aria-hidden="true"] td')?.colSpan).toBe(1))
  expect(observers).toHaveLength(1)
})

it('初回ROの幅が直前の表幅から変わった場合も列の変化を見落とさない', async () => {
  setup()
  const { container } = render(<table><TableBody items={items} itemKey={keys} colSpan={2} estimatedRowHeight={59} renderRow={item => <tr>
    <td>名前{item}</td><td>補助</td>
  </tr>} /></table>)
  await act(async () => {})
  const first = container.querySelector<HTMLTableRowElement>('[data-table-index="0"]')!
  first.cells[1].style.display = 'none'
  act(() => callbacks[0]?.([{ target: first, borderBoxSize: [{ blockSize: 59, inlineSize: 90 }] }] as unknown as ResizeObserverEntry[], {} as ResizeObserver))
  await waitFor(() => expect(container.querySelector<HTMLTableCellElement>('tr[aria-hidden="true"] td')?.colSpan).toBe(1))
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
  const subscriptions = observers.length
  rerender(<table><TableBody items={items} itemKey={keys} colSpan={1} renderRow={renderRow} /></table>)
  expect(renderRow.mock.calls.filter(([item]) => item === 0)).toHaveLength(1)
  expect(observers).toHaveLength(subscriptions)
  const updated = vi.fn((item: number) => <tr aria-selected={item === 0}><td><button onClick={() => select(item + 1)}>更新{item}</button></td></tr>)
  rerender(<table><TableBody items={items} itemKey={keys} colSpan={1} renderRow={updated} /></table>)
  expect(screen.getByText('更新0').closest('tr')?.getAttribute('aria-selected')).toBe('true')
  fireEvent.click(screen.getByText('更新0'))
  expect(select).toHaveBeenLastCalledWith(1)
})


it('窓だけの移動とリサイズでは監視を作り直さず、入った行だけ購読して離れた行を外す', async () => {
  setup()
  const { container } = render(<table><TableBody items={items} itemKey={keys} colSpan={1} renderRow={row} /></table>)
  const observer = observers[0]
  const initialRows = [...container.querySelectorAll('[data-table-index]')]
  expect(observers).toHaveLength(1)
  top = -1900 * 58
  fireEvent.scroll(window)
  await screen.findByText('行1900')
  expect(observers).toHaveLength(1)
  expect(observer.disconnect).not.toHaveBeenCalled()
  for (const oldRow of initialRows) expect(observer.unobserve).toHaveBeenCalledWith(oldRow)
  for (const mounted of container.querySelectorAll('[data-table-index]')) expect(observer.observe).toHaveBeenCalledWith(mounted)
  fireEvent(window, new Event('resize'))
  await waitFor(() => expect(screen.getByText('行1900')).toBeTruthy())
  expect(observers).toHaveLength(1)
})

it('後から入った行の高さも反映し、末尾の詰め物を実測分だけ伸ばす', async () => {
  setup()
  const { container } = render(<table><TableBody items={items} itemKey={keys} colSpan={1} renderRow={row} /></table>)
  act(() => callbacks.at(-1)?.([...container.querySelectorAll('[data-table-index]')].map(target => ({ target })) as ResizeObserverEntry[], {} as ResizeObserver))
  await waitFor(() => expect(container.querySelectorAll('[data-table-index]').length).toBeLessThan(20))
  expect(observers).toHaveLength(1)
  top = -1900 * 59
  fireEvent.scroll(window)
  const entered = (await screen.findByText('行1900')).closest('tr')!
  Object.defineProperty(entered, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, bottom: 83, height: 83, width: 100 }) })
  expect(observers.at(-1)?.observe).toHaveBeenCalledWith(entered)
  act(() => callbacks.at(-1)?.([{ target: entered }] as ResizeObserverEntry[], {} as ResizeObserver))
  await waitFor(() => {
    const spacers = [...container.querySelectorAll('tr[aria-hidden="true"] td')].reduce((sum, cell) => sum + parseFloat((cell as HTMLElement).style.height), 0)
    const mountedHeight = [...container.querySelectorAll('[data-table-index]')].reduce((sum, row) => sum + row.getBoundingClientRect().height, 0)
    expect(spacers + mountedHeight).toBe(2000 * 59 + 24)
  })
})

it('窓の最後からTabで次の行へ進み、逆向きにも未描画の行へ戻れる', async () => {
  setup()
  const { container } = render(<table><TableBody items={items} itemKey={keys} colSpan={1} renderRow={row} /></table>)
  const last = [...container.querySelectorAll<HTMLElement>('[data-table-index]')].at(-1)!
  const next = Number(last.dataset.tableIndex) + 1
  expect(screen.queryByText(`行${next}`)).toBeNull()
  const button = last.querySelector('button')!
  button.focus()
  fireEvent.keyDown(button, { key: 'Tab' })
  await waitFor(() => expect(document.activeElement).toBe(screen.getByText(`行${next}`)))
  top = -1900 * 58
  fireEvent.scroll(window)
  await screen.findByText('行1900')
  // Release the retained first window before testing the leading edge.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  fireEvent.scroll(window)
  await waitFor(() => expect(screen.queryByText(`行${next}`)).toBeNull())
  const first = container.querySelector<HTMLElement>('[data-table-index]')!
  const previous = Number(first.dataset.tableIndex) - 1
  expect(screen.queryByText(`行${previous}`)).toBeNull()
  const firstButton = first.querySelector('button')!
  firstButton.focus()
  fireEvent.keyDown(firstButton, { key: 'Tab', shiftKey: true })
  await waitFor(() => expect(document.activeElement).toBe(screen.getByText(`行${previous}`)))
})

it('スクロールでは列と祖先のスタイルを読み直さず、幅の変更では畳まれた列を再確認する', async () => {
  setup()
  const computed = vi.spyOn(window, 'getComputedStyle')
  const { container } = render(<table><TableBody items={items} itemKey={keys} colSpan={2} renderRow={(item) => <tr>
    <td>名前{item}</td><td><button>操作{item}</button></td>
  </tr>} /></table>)
  await waitFor(() => expect(computed.mock.calls.length).toBeGreaterThan(0))
  const initial = computed.mock.calls.length
  top = -1900 * 58
  fireEvent.scroll(window)
  await screen.findByText('名前1900')
  expect(computed.mock.calls.length).toBe(initial)
  for (const row of container.querySelectorAll<HTMLTableRowElement>('[data-table-index]')) row.cells[1].style.display = 'none'
  fireEvent(window, new Event('resize'))
  await waitFor(() => expect(container.querySelector<HTMLTableCellElement>('tr[aria-hidden="true"] td')?.colSpan).toBe(1))
  expect(computed.mock.calls.length).toBeGreaterThan(initial)
})

it('配信済みの行高さを使い、実測更新でも監視を作り直さない', async () => {
  setup()
  const { container } = render(<table><TableBody items={items} itemKey={keys} colSpan={1} renderRow={row} /></table>)
  const first = container.querySelector<HTMLElement>('[data-table-index]')!
  const rect = vi.fn(() => ({ height: 59, width: 100 } as DOMRect))
  Object.defineProperty(first, 'getBoundingClientRect', { configurable: true, value: rect })
  act(() => callbacks[0]?.([{ target: first, borderBoxSize: [{ blockSize: 83, inlineSize: 100 }] }] as unknown as ResizeObserverEntry[], {} as ResizeObserver))
  await waitFor(() => {
    const spacers = [...container.querySelectorAll<HTMLElement>('tr[aria-hidden="true"] td')].reduce((sum, cell) => sum + parseFloat(cell.style.height), 0)
    expect(spacers).toBe((2000 - container.querySelectorAll('[data-table-index]').length) * 83)
  })
  expect(rect).not.toHaveBeenCalled()
  expect(observers).toHaveLength(1)
  expect(observers[0].disconnect).not.toHaveBeenCalled()
})
