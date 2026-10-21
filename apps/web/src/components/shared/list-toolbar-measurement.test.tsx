// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import FilterChip from './filter-chip'
import { ListToolbarFrame, ListToolbarOptional, ListToolbarRow, ResponsiveFilterChips } from './list-toolbar'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function environment() {
  const observers: { callback: ResizeObserverCallback; observe: ReturnType<typeof vi.fn>; unobserve: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = []
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn()
    constructor(public callback: ResizeObserverCallback) { observers.push(this) }
  })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000)
  const reads = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 32))
  return { observers, reads }
}

it.each(['overflow', 'filters'])('%sの同じ内容の親再描画では監視を作り直さず、最新の操作と内容変更を保つ', async kind => {
  const { observers, reads } = environment()
  const oldChange = vi.fn(), change = vi.fn()
  const view = (label: string, onChange: () => void) => <ListToolbarFrame><ListToolbarRow>{kind === 'overflow'
    ? <ListToolbarOptional collapse="overflow"><input aria-label="担当者" defaultValue="店長" /><button onClick={onChange}>{label}</button></ListToolbarOptional>
    : <ResponsiveFilterChips><FilterChip selected={false} onChange={onChange}>{label}</FilterChip></ResponsiveFilterChips>
  }</ListToolbarRow></ListToolbarFrame>
  const { rerender } = render(view('予約のみ', oldChange))
  await act(async () => { await Promise.resolve() })
  const instances = observers.length
  reads.mockClear()
  rerender(view('予約のみ', change))
  const synchronousReads = reads.mock.calls.length
  await act(async () => { await Promise.resolve() })
  expect(observers).toHaveLength(instances)
  expect(reads).toHaveBeenCalledTimes(synchronousReads)
  fireEvent.click(screen.getByRole('button', { name: '予約のみ' }))
  expect(oldChange).not.toHaveBeenCalled()
  expect(change).toHaveBeenCalledOnce()
  rerender(view('予約済みの長い条件をすべて確認', change))
  await act(async () => { await Promise.resolve() })
  expect(reads).toHaveBeenCalled()
  expect(observers).toHaveLength(instances)
  expect(screen.getByRole('button', { name: '予約済みの長い条件をすべて確認' })).toBeTruthy()
  if (kind === 'overflow') expect(screen.getByRole<HTMLInputElement>('textbox', { name: '担当者' }).value).toBe('店長')
})

it('適用済みフォントのreadyで初回を二重計測せず、読込中は適用時に再計測して解除後は触らない', async () => {
  const original = Object.getOwnPropertyDescriptor(document, 'fonts')
  let status = 'loaded', ready = () => {}
  const loaded = Promise.resolve(), loading = new Promise<void>(resolve => { ready = resolve })
  const fonts = { get status() { return status }, get ready() { return status === 'loaded' ? loaded : loading } }
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
  const { reads, observers } = environment()
  const view = <ListToolbarFrame><ListToolbarRow><ResponsiveFilterChips><FilterChip selected={false} onChange={() => {}}>予約のみ</FilterChip></ResponsiveFilterChips></ListToolbarRow></ListToolbarFrame>
  try {
    const mounted = render(view)
    const initial = reads.mock.calls.length
    await act(async () => { await loaded })
    // 外枠自身のready処理は残るため、札の寸法だけを数える。
    const chipReads = reads.mock.contexts.filter(node => (node as HTMLElement).hasAttribute('data-filter-chips'))
    expect(chipReads).toHaveLength(2)
    expect(initial).toBeGreaterThan(0)
    mounted.unmount()
    status = 'loading'; reads.mockClear()
    const next = render(view)
    const before = reads.mock.contexts.filter(node => (node as HTMLElement).hasAttribute('data-filter-chips')).length
    await act(async () => { status = 'loaded'; ready(); await loading })
    expect(reads.mock.contexts.filter(node => (node as HTMLElement).hasAttribute('data-filter-chips')).length).toBeGreaterThan(before)
    next.unmount(); reads.mockClear()
    act(() => { observers.filter(observer => observer.observe.mock.calls.some(([node]) => (node as HTMLElement).querySelector(':scope > [data-filter-chips]'))).forEach(observer => observer.callback([], {} as ResizeObserver)) })
    expect(reads.mock.contexts.filter(node => (node as HTMLElement).hasAttribute('data-filter-chips'))).toHaveLength(0)
  } finally { if (original) Object.defineProperty(document, 'fonts', original); else Reflect.deleteProperty(document, 'fonts') }
})

it('札の実幅変更と追加は再計測し、畳んだ状態でも選択を元の処理へ返す', async () => {
  const { observers } = environment()
  let available = 1000
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => available)
  const change = vi.fn()
  const view = (extra = false) => <ListToolbarFrame><ListToolbarRow><ResponsiveFilterChips>
    <FilterChip selected={false} onChange={change}>予約のみ</FilterChip>
    {extra ? <FilterChip selected={false} onChange={change}>停止中</FilterChip> : null}
  </ResponsiveFilterChips></ListToolbarRow></ListToolbarFrame>
  const { container, rerender } = render(view())
  const choices = container.querySelector('[data-filter-chips]')!.parentElement!
  expect(choices.hasAttribute('data-filter-collapsed')).toBe(false)
  available = 50
  act(() => { observers.forEach(observer => observer.callback([], {} as ResizeObserver)) })
  expect(choices.hasAttribute('data-filter-collapsed')).toBe(true)
  rerender(view(true))
  await act(async () => { await Promise.resolve() })
  fireEvent.click(screen.getByRole('button', { name: '状態' }))
  fireEvent.click(screen.getByRole('option', { name: /停止中/ }).querySelector('button')!)
  expect(change).toHaveBeenCalledWith(true)
  available = 1000
  act(() => { observers.forEach(observer => observer.callback([], {} as ResizeObserver)) })
  expect(choices.hasAttribute('data-filter-collapsed')).toBe(false)
})

it('増えた操作も監視し、取り除いた操作だけ解除する', async () => {
  const { observers } = environment()
  const view = (extra: boolean) => <ListToolbarFrame><ListToolbarRow><ListToolbarOptional collapse="overflow">
    <button>条件を選ぶ</button>{extra ? <input aria-label="新しい条件" /> : null}
  </ListToolbarOptional></ListToolbarRow></ListToolbarFrame>
  const { rerender } = render(view(false))
  const existing = observers.length
  rerender(view(true))
  await act(async () => { await Promise.resolve() })
  const input = screen.getByRole('textbox', { name: '新しい条件' })
  expect(observers).toHaveLength(existing)
  const optionalObserver = observers.find(observer => observer.observe.mock.calls.some(([target]) => target === input))!
  expect(optionalObserver).toBeTruthy()
  rerender(view(false))
  await act(async () => { await Promise.resolve() })
  expect(screen.queryByRole('textbox', { name: '新しい条件' })).toBeNull()
  expect(optionalObserver.unobserve).toHaveBeenCalledWith(input)
})

it('伸びた道具の余白と整数scrollWidthの丸めを需要に数えず、実測した操作幅で畳む', async () => {
  const { toolbarContentFit } = await import('./list-toolbar-fit.mjs')
  const toolbar = document.createElement('div'), chips = document.createElement('span'), optional = document.createElement('details')
  toolbar.style.display = 'flex'; toolbar.style.columnGap = '8px'
  chips.textContent = '予約のみ'; optional.textContent = '保存した条件'
  optional.dataset.toolbarOverflowGroup = ''; optional.style.flexGrow = '1'
  optional.style.setProperty('--toolbar-optional-width', '216px')
  toolbar.append(chips, optional); document.body.append(toolbar)
  vi.spyOn(toolbar, 'clientWidth', 'get').mockReturnValue(1392)
  vi.spyOn(chips, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 139.171875, 32))
  vi.spyOn(chips, 'scrollWidth', 'get').mockReturnValue(139)
  const rect = vi.spyOn(optional, 'getBoundingClientRect').mockReturnValue(new DOMRect(147.171875, 0, 1244.828125, 32))
  const scroll = vi.spyOn(optional, 'scrollWidth', 'get').mockReturnValue(1245)
  try {
    expect(toolbarContentFit(toolbar)).toEqual({ available: 1392, required: 363.171875, fits: true })
    expect(toolbarContentFit(toolbar, optional, 216, false).fits).toBe(true)
    optional.style.setProperty('--toolbar-optional-width', '1300px')
    expect(toolbarContentFit(toolbar).fits).toBe(false)
    optional.setAttribute('data-collapsed', '')
    rect.mockReturnValue(new DOMRect(147.171875, 0, 129, 32)); scroll.mockReturnValue(129)
    expect(toolbarContentFit(toolbar).fits).toBe(true)
    expect(toolbarContentFit(toolbar, optional, 1300, false).fits).toBe(false)
    optional.removeAttribute('data-collapsed'); optional.style.removeProperty('--toolbar-optional-width')
    expect(toolbarContentFit(toolbar).required).toBe(276.171875)
  } finally { toolbar.remove() }
})
