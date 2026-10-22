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

it.each(['overflow', 'filters'])('%sの自然幅を確定してから寸法を読み直さず、同じ読取結果で収まりを判断する', kind => {
  const { observers, reads } = environment()
  const { container } = render(<ListToolbarFrame><ListToolbarRow>{kind === 'overflow'
    ? <ListToolbarOptional collapse="overflow"><button>保存した検索</button></ListToolbarOptional>
    : <ResponsiveFilterChips><FilterChip selected={false} onChange={() => {}}>予約のみ</FilterChip></ResponsiveFilterChips>
  }</ListToolbarRow></ListToolbarFrame>)
  const subject = kind === 'overflow' ? container.querySelector<HTMLElement>('details')! : container.querySelector<HTMLElement>('[data-filter-chips]')!.parentElement!
  const committedWidth = () => kind === 'overflow' ? subject.style.getPropertyValue('--toolbar-optional-width') : subject.dataset.filterWidth
  if (kind === 'overflow') { subject.style.setProperty('--toolbar-optional-width', '1px'); subject.style.flexGrow = '1' }
  else subject.dataset.filterWidth = '1'
  const before = committedWidth(), phases: string[] = []
  const record = () => phases.push(committedWidth() === before ? 'read' : 'read-after-width-write')
  reads.mockImplementation(function (this: HTMLElement) { record(); return new DOMRect(0, 0, 100, 32) })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => { record(); return 1000 })
  const watched = kind === 'overflow' ? subject.querySelector('button') : subject
  const observer = observers.find(instance => instance.observe.mock.calls.some(([node]) => node === watched))!
  expect(observer).toBeTruthy()
  act(() => { observer.callback([], {} as ResizeObserver) })
  expect(committedWidth()).toBe(kind === 'overflow' ? '100px' : '100')
  expect(subject.hasAttribute(kind === 'overflow' ? 'data-collapsed' : 'data-filter-collapsed')).toBe(false)
  expect(phases.length).toBeGreaterThan(0)
  expect(phases).not.toContain('read-after-width-write')
})

it.each(['direct', 'nested', 'inside-measured-group'])('自然幅のsnapshotは%sの既存の札の数え方と一致し、属性を書かない', async placement => {
  const { toolbarContentFit } = await import('./list-toolbar-fit.mjs')
  const toolbar = document.createElement('div'), tool = document.createElement('span')
  const group = placement === 'direct' ? tool : document.createElement('span')
  group.textContent = '予約のみ'; if (group !== tool) tool.append(group)
  if (placement === 'inside-measured-group') tool.dataset.filterWidth = '90'
  toolbar.append(tool); document.body.append(toolbar)
  vi.spyOn(toolbar, 'clientWidth', 'get').mockReturnValue(150)
  vi.spyOn(tool, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 32))
  if (group !== tool) vi.spyOn(group, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 40, 32))
  try {
    const snapshot = toolbarContentFit(toolbar, null, 0, true, false, { filter: { element: group, width: 160 } })
    expect(group.hasAttribute('data-filter-width')).toBe(false)
    group.dataset.filterWidth = '160'
    expect(snapshot).toEqual(toolbarContentFit(toolbar))
    expect(snapshot.fits).toBe(placement === 'inside-measured-group')
    expect(toolbarContentFit(toolbar, null, 0, false).required).toBe(100)
  } finally { toolbar.remove() }
})

it('札の自然幅が増えた通知では、書込前の小さい幅に惑わされず選択を保って畳む', () => {
  const { observers, reads } = environment()
  const change = vi.fn()
  const { container } = render(<ListToolbarFrame><ListToolbarRow><ResponsiveFilterChips>
    <FilterChip selected onChange={change}>予約済み</FilterChip>
  </ResponsiveFilterChips></ListToolbarRow></ListToolbarFrame>)
  const wide = container.querySelector<HTMLElement>('[data-filter-chips]')!, choices = wide.parentElement!
  choices.dataset.filterWidth = '100'
  reads.mockImplementation(function (this: HTMLElement) { return new DOMRect(0, 0, this === wide ? 240 : 100, 32) })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200)
  const observer = observers.find(instance => instance.observe.mock.calls.some(([node]) => node === choices))!
  act(() => { observer.callback([], {} as ResizeObserver) })
  expect(choices.dataset.filterWidth).toBe('240')
  expect(choices.hasAttribute('data-filter-collapsed')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '状態' }))
  expect(screen.getByRole('option', { name: /予約済み/ }).getAttribute('aria-selected')).toBe('true')
  expect(change).not.toHaveBeenCalled()
})

it.each([['0', 100], ['', 100], ['1', 0]] as const)('伸び率「%s」の操作が200から%dへ縮む通知で、反映後の幅で収まりを判断する', (grow, nextWidth) => {
  const { observers, reads } = environment()
  let natural = 200, available = 400
  const nativeStyle = getComputedStyle
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation(element => {
    const css = nativeStyle(element)
    return element.tagName !== 'DETAILS' ? css : new Proxy(css, { get(target, property) {
      if (property === 'flexGrow') return grow
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  })
  reads.mockImplementation(function (this: HTMLElement) {
    const optional = this.tagName === 'DETAILS' ? this : this.querySelector<HTMLElement>('details')
    const width = optional ? Math.max(natural, Number.parseFloat(optional.style.getPropertyValue('--toolbar-optional-width')) || 0) : natural
    return new DOMRect(0, 0, width, 32)
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => available)
  const { container } = render(<ListToolbarFrame><ListToolbarRow><ListToolbarOptional collapse="overflow"><button>保存した検索</button></ListToolbarOptional></ListToolbarRow></ListToolbarFrame>)
  const item = container.querySelector('details')!, button = item.querySelector('button')!
  expect(item.style.getPropertyValue('--toolbar-optional-width')).toBe('200px')
  expect(item.hasAttribute('data-collapsed')).toBe(false)
  const attributes = vi.spyOn(item, 'setAttribute')
  natural = nextWidth; available = 150
  const observer = observers.find(instance => instance.observe.mock.calls.some(([node]) => node === button))!
  act(() => { observer.callback([], {} as ResizeObserver) })
  expect(item.style.getPropertyValue('--toolbar-optional-width')).toBe(`${nextWidth}px`)
  expect(item.hasAttribute('data-collapsed')).toBe(false)
  expect(attributes.mock.calls.some(([name]) => name === 'data-collapsed')).toBe(false)
})

it.each([0, 216])('操作の自然幅%dをsnapshotで渡しても即時fitと同じ需要になり、測定中はDOM幅を書かない', async width => {
  const { toolbarContentFit, measureToolbarOptionalWidth, fitToolbarOptionalWidth } = await import('./list-toolbar-fit.mjs')
  const toolbar = document.createElement('div'), item = document.createElement('details'), content = document.createElement('div'), button = document.createElement('button')
  content.dataset.toolbarOptionalContent = ''; content.append(button); item.append(content)
  item.dataset.toolbarOverflowGroup = ''; item.style.flexGrow = '1'; item.style.setProperty('--toolbar-optional-width', '900px')
  toolbar.append(item); document.body.append(toolbar)
  vi.spyOn(toolbar, 'clientWidth', 'get').mockReturnValue(200)
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, width, 32))
  vi.spyOn(item, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 32))
  try {
    const measured = measureToolbarOptionalWidth(item)
    expect(measured).toBe(width)
    const snapshot = toolbarContentFit(toolbar, item, width, false, false, { optional: { element: item, width } })
    expect(item.style.getPropertyValue('--toolbar-optional-width')).toBe('900px')
    expect(fitToolbarOptionalWidth(item)).toBe(width)
    expect(item.style.getPropertyValue('--toolbar-optional-width')).toBe(`${width}px`)
    expect(snapshot).toEqual(toolbarContentFit(toolbar, item, width, false))
    item.setAttribute('data-collapsed', '')
    expect(measureToolbarOptionalWidth(item)).toBeNull()
    expect(fitToolbarOptionalWidth(item)).toBe(0)
    expect(item.style.getPropertyValue('--toolbar-optional-width')).toBe(`${width}px`)
  } finally { toolbar.remove() }
})
