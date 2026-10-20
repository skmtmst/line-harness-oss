// @vitest-environment happy-dom
import { useRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useListRowDensity } from './use-list-row-density'
import { useTableActionWidth } from './use-table-action-width'
import { listRowContentLines } from './list-row-density.mjs'

vi.mock('./list-row-density.mjs', () => ({
  listRowContentLines: vi.fn((row: HTMLElement) => row.querySelectorAll('[data-text-line]').length),
}))

let nextFrame: number
let frames: Map<number, FrameRequestCallback>
let notifyResize: (() => void)[]

beforeEach(() => {
  nextFrame = 0
  frames = new Map()
  notifyResize = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = ++nextFrame
    frames.set(id, callback)
    return id
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id) })
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { notifyResize.push(callback) }
    observe() {}
    disconnect() {}
  })
  vi.mocked(listRowContentLines).mockImplementation((row) => row.querySelectorAll('[data-text-line]').length)
})

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function DensityTable({ lines = [1, 2, 3], dedicated = false }: { lines?: number[]; dedicated?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useListRowDensity(ref)
  return <section data-list-skeleton=""><div ref={ref} data-table-presentation={dedicated ? 'dashboard-inbox' : undefined}>
    <table><tbody>{lines.map((count, index) => <tr key={index} data-shared-part="list-row">
      <td>{Array.from({ length: count }, (_, line) => <span key={line} data-text-line="">本文</span>)}</td>
    </tr>)}</tbody></table>
  </div></section>
}

async function flushFrame() {
  const batch = [...frames.values()]
  frames.clear()
  await act(async () => { for (const callback of batch) callback(0) })
}

it('reads all rows before changing any height, so one row cannot force layout for the next', async () => {
  const observations: (string | undefined)[][] = []
  vi.mocked(listRowContentLines).mockImplementation((row) => {
    observations.push([...document.querySelectorAll<HTMLElement>('tr')].map((item) => item.dataset.listContentLines))
    return row.querySelectorAll('[data-text-line]').length
  })
  render(<DensityTable />)
  await flushFrame()
  expect(observations).toEqual(Array.from({ length: 3 }, () => [undefined, undefined, undefined]))
  expect([...document.querySelectorAll<HTMLElement>('tr')].map((row) => row.dataset.listContentLines)).toEqual(['1', '2', '3'])
})

it('coalesces repeated resize notifications and still updates after filtering or a dedicated presentation', async () => {
  const { rerender } = render(<DensityTable lines={[1]} />)
  for (let i = 0; i < 10; i++) notifyResize[0]()
  expect(frames.size).toBe(1)
  expect(window.cancelAnimationFrame).not.toHaveBeenCalled()
  await flushFrame()
  expect(document.querySelector<HTMLElement>('tr')?.dataset.listContentLines).toBe('1')
  rerender(<DensityTable lines={[2]} />)
  await act(async () => { await Promise.resolve() })
  await flushFrame()
  expect(document.querySelector<HTMLElement>('tr')?.dataset.listContentLines).toBe('2')
  rerender(<DensityTable lines={[2]} dedicated />)
  await act(async () => { await Promise.resolve() })
  await flushFrame()
  expect(document.querySelector<HTMLElement>('tr')?.hasAttribute('data-list-content-lines')).toBe(false)
})

function ActionTable() {
  const ref = useTableActionWidth<HTMLDivElement>()
  return <div ref={ref} data-testid="actions" />
}

it('does not write an unchanged action width and start another density measurement', async () => {
  const { getByTestId } = render(<ActionTable />)
  const table = getByTestId('actions')
  const writes = vi.spyOn(table.style, 'setProperty')
  await flushFrame()
  expect(table.style.getPropertyValue('--row-action-width')).toBe('0px')
  for (let i = 0; i < 10; i++) notifyResize[0]()
  await flushFrame()
  expect(writes.mock.calls.filter(([name]) => name === '--row-action-width')).toHaveLength(1)
})
