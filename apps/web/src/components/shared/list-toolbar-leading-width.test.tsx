// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ListToolbar, { ListToolbarFrame, ListToolbarLeading, ListToolbarRow, ListToolbarSearchSlot } from './list-toolbar'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function environment() {
  let leadingWidth = 96
  const observers: { callback: ResizeObserverCallback; active: boolean; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = []
  vi.stubGlobal('ResizeObserver', class {
    active = false
    observe = vi.fn(() => { this.active = true }); disconnect = vi.fn(() => { this.active = false })
    constructor(public callback: ResizeObserverCallback) { observers.push(this) }
  })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const widths = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000)
  const reads = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return new DOMRect(0, 0, this.hasAttribute('data-toolbar-leading') ? leadingWidth : 100, 36)
  })
  const writes = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty')
  return {
    widths, reads, writes, observers,
    setLeadingWidth: (width: number) => { leadingWidth = width },
    resize: () => act(() => { observers.filter(observer => observer.active).forEach(observer => observer.callback([], {} as ResizeObserver)) }),
    leadingReads: () => reads.mock.contexts.filter(node => node.hasAttribute('data-toolbar-leading')),
    leadingWrites: () => writes.mock.calls.filter(([property]) => property === '--toolbar-leading-width'),
  }
}

const flush = () => act(async () => { await Promise.resolve() })

it.each(['band', 'band-slot-no-frame', 'frame-band', 'frame-no-search'])('keeps fit and actions without measuring an unused leading width: %s', async kind => {
  const env = environment(), create = vi.fn()
  const band = <ListToolbar search={{ value: '入力済み', placeholder: '名前で探す', onChange: vi.fn() }} />
  const view = render(<ListToolbarLeading leading={<button onClick={create}>作る</button>}>
    {kind === 'band' ? band : kind === 'band-slot-no-frame'
      ? <ListToolbar searchSlot={<ListToolbarRow><ListToolbarSearchSlot><input defaultValue="入力済み" /></ListToolbarSearchSlot></ListToolbarRow>} />
      : <ListToolbarFrame>{kind === 'frame-band' ? band : <ListToolbarRow><button>状態を選ぶ</button></ListToolbarRow>}</ListToolbarFrame>}
  </ListToolbarLeading>)
  await flush()
  const toolbars = [...view.container.querySelectorAll<HTMLElement>('[data-toolbar-layout="band"], [data-toolbar-layout="slots"]')]
  // A direct leading control is still measured once by the actual fit budget.
  const onlyFitReads = () => kind === 'frame-no-search' ? env.widths.mock.contexts.filter(node => toolbars.includes(node)).length : 0
  expect(toolbars.length).toBeGreaterThan(0)
  expect(env.leadingReads()).toHaveLength(onlyFitReads())
  expect(env.leadingWrites()).toHaveLength(0)
  for (const toolbar of toolbars) {
    expect(toolbar.style.getPropertyValue('--toolbar-leading-width')).toBe('')
    expect(env.widths.mock.contexts).toContain(toolbar)
    expect(toolbar.dataset.toolbarFit).toBe('single')
  }
  env.resize()
  expect(env.leadingReads()).toHaveLength(onlyFitReads())
  expect(env.leadingWrites()).toHaveLength(0)
  fireEvent.click(screen.getAllByRole('button', { name: '作る' })[0])
  expect(create).toHaveBeenCalledOnce()
  if (kind !== 'frame-no-search') expect(view.container.querySelector('input')?.value).toBe('入力済み')
})

it.each(['single', 'frames', 'band'])('preserves slot inheritance, updates changed geometry and skips equal writes (nested=%s)', async nested => {
  const env = environment()
  const row = <ListToolbarRow><ListToolbarSearchSlot><input aria-label="検索" defaultValue="残す入力" /></ListToolbarSearchSlot></ListToolbarRow>
  const view = render(<ListToolbarLeading leading={<button>作る</button>}>
    <ListToolbarFrame>{nested === 'frames' ? <ListToolbarFrame>{row}</ListToolbarFrame> : nested === 'band' ? <ListToolbar searchSlot={row} /> : row}</ListToolbarFrame>
  </ListToolbarLeading>)
  await flush()
  const roots = [...view.container.querySelectorAll<HTMLElement>('[data-toolbar-layout="slots"], [data-toolbar-layout="band"]')]
  expect(roots).toHaveLength(nested === 'single' ? 1 : 2)
  for (const root of roots) expect(root.style.getPropertyValue('--toolbar-leading-width')).toBe('96px')
  env.writes.mockClear()
  env.resize()
  expect(env.leadingWrites()).toHaveLength(0)
  env.setLeadingWidth(152.25)
  env.resize()
  expect(env.leadingWrites()).toHaveLength(roots.length)
  for (const root of roots) expect(root.style.getPropertyValue('--toolbar-leading-width')).toBe('153px')
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '検索' }).value).toBe('残す入力')
  env.writes.mockClear()
  view.unmount()
  expect(env.observers.every(observer => observer.disconnect.mock.calls.length > 0)).toBe(true)
  env.resize()
  expect(env.leadingWrites()).toHaveLength(0)
})

it('starts measuring a newly added slot and clears its inherited reservation when the leading control disappears', async () => {
  const env = environment()
  const content = (search: boolean, leading: boolean) => <ListToolbarLeading leading={leading ? <button>作る</button> : null}>
    <ListToolbarFrame><ListToolbarRow>{search
      ? <ListToolbarSearchSlot><input aria-label="検索" defaultValue="値を残す" /></ListToolbarSearchSlot>
      : <button>状態を選ぶ</button>}
    </ListToolbarRow></ListToolbarFrame>
  </ListToolbarLeading>
  const view = render(content(false, true))
  await flush()
  const root = view.container.querySelector<HTMLElement>('[data-toolbar-layout="slots"]')!
  expect(root.style.getPropertyValue('--toolbar-leading-width')).toBe('')
  view.rerender(content(true, true))
  await flush()
  env.resize()
  expect(view.container.querySelector('[data-toolbar-layout="slots"]')).toBe(root)
  expect(root.style.getPropertyValue('--toolbar-leading-width')).toBe('96px')
  view.rerender(content(true, false))
  await flush()
  env.resize()
  expect(root.style.getPropertyValue('--toolbar-leading-width')).toBe('0px')
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '検索' }).value).toBe('値を残す')
})
