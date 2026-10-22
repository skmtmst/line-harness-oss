// @vitest-environment happy-dom
import React, { StrictMode } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import KpiCard, { type KpiCardProps } from './kpi-card'
import { KpiValueMotionProvider } from './kpi-value-motion'

let media: MediaQueryList
const props: KpiCardProps = { title: '友だち', value: 1234, unit: '人', detail: null }
const view = (scope: string | null = 'account-a:today', overrides: Partial<KpiCardProps> = {}, visible = true) => (
  <KpiValueMotionProvider scope={scope}>{visible ? <KpiCard {...props} {...overrides} /> : null}</KpiValueMotionProvider>
)
const paint = () => act(() => { vi.advanceTimersByTime(17) })
const rollOf = (container: HTMLElement) => container.querySelector('[data-kpi-roll]')
const numberOf = (container: HTMLElement) => container.querySelector('[data-kpi-number]')
const finish = (container: HTMLElement) => {
  const roll = rollOf(container)
  if (roll) fireEvent.animationEnd(roll)
}

beforeEach(() => {
  vi.useFakeTimers()
  media = Object.assign(new EventTarget(), { matches: false, media: '(prefers-reduced-motion: reduce)' }) as MediaQueryList
  vi.spyOn(window, 'matchMedia').mockReturnValue(media)
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete')
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => window.setTimeout(() => callback(0), 16))
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(handle => window.clearTimeout(handle))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('初回のDOMとサーバー出力に本当の値を置き、描画後の装飾だけ読み上げから隠す', () => {
  expect(renderToString(view())).toContain('>1,234</span>')
  const { container } = render(view())
  expect(numberOf(container)?.textContent).toBe('1,234')
  expect(rollOf(container)).toBeNull()
  paint()
  expect(rollOf(container)?.getAttribute('aria-hidden')).toBe('true')
  expect(numberOf(container)?.textContent).toBe('1,234')
  expect(numberOf(container)?.closest('[aria-hidden="true"]')).toBeNull()
  finish(container)
  expect(rollOf(container)).toBeNull()
  expect(numberOf(container)?.textContent).toBe('1,234')
})

it('同じ値の読み直しでは回さず、同じ条件で値が変わると回す', () => {
  const { container, rerender } = render(view())
  paint(); finish(container)
  rerender(view(undefined, { value: 1234 }))
  paint()
  expect(rollOf(container)).toBeNull()
  rerender(view(undefined, { value: 1235 }))
  expect(numberOf(container)?.textContent).toBe('1,235')
  expect(rollOf(container)).toBeNull()
  paint()
  expect(rollOf(container)).not.toBeNull()
})

it.each(['account-a:last7', 'account-b:today'])('条件切替%sと元の条件へ戻すときは回さない', scope => {
  const { container, rerender } = render(view())
  paint()
  rerender(view(scope, { value: 99 }))
  expect(numberOf(container)?.textContent).toBe('99')
  expect(rollOf(container)).toBeNull()
  paint()
  expect(rollOf(container)).toBeNull()
  rerender(view(undefined, { value: 1236 }))
  paint()
  expect(rollOf(container)).toBeNull()
  rerender(view(undefined, { value: 1237 }))
  paint()
  expect(rollOf(container)).not.toBeNull()
})

it('切替時に骨組みを挟んでも新しい値を回さない', () => {
  const { container, rerender } = render(view())
  paint(); finish(container)
  rerender(view('account-b:today', { loading: true, value: null }))
  rerender(view('account-b:today', { value: 33 }))
  paint()
  expect(numberOf(container)?.textContent).toBe('33')
  expect(rollOf(container)).toBeNull()
})

it('読み直しで帯自体が外れても同じ値を回さず、値の更新は回す', () => {
  const { container, rerender } = render(view())
  paint(); finish(container)
  rerender(view(undefined, {}, false))
  rerender(view())
  paint()
  expect(rollOf(container)).toBeNull()
  rerender(view(undefined, {}, false))
  rerender(view(undefined, { value: 1236 }))
  paint()
  expect(rollOf(container)).not.toBeNull()
})

it('骨組みと欠測から最初の値が届いたときは一度だけ回す', () => {
  const { container, rerender } = render(view(undefined, { loading: true, value: null }))
  paint()
  expect(rollOf(container)).toBeNull()
  rerender(view(undefined, { value: null }))
  paint()
  expect(numberOf(container)?.textContent).toBe('—')
  expect(rollOf(container)).toBeNull()
  rerender(view(undefined, { value: 0 }))
  paint()
  expect(numberOf(container)?.textContent).toBe('0')
  expect(rollOf(container)).not.toBeNull()
})

it('動きを減らす場合は初回も値の更新もすぐに最終値を出す', () => {
  Object.assign(media, { matches: true })
  const { container, rerender } = render(view())
  paint()
  expect(rollOf(container)).toBeNull()
  rerender(view(undefined, { value: 1235 }))
  paint()
  expect(numberOf(container)?.textContent).toBe('1,235')
  expect(rollOf(container)).toBeNull()
})

it('待機中と演出中の減らす設定への変更を受け、解除してもやり直さない', () => {
  const { container, rerender } = render(view())
  act(() => { Object.assign(media, { matches: true }); media.dispatchEvent(new Event('change')) })
  paint()
  expect(rollOf(container)).toBeNull()
  act(() => { Object.assign(media, { matches: false }); media.dispatchEvent(new Event('change')) })
  rerender(view(undefined, { value: 1235 }))
  paint()
  expect(rollOf(container)).not.toBeNull()
  act(() => { Object.assign(media, { matches: true }); media.dispatchEvent(new Event('change')) })
  expect(rollOf(container)).toBeNull()
  act(() => { Object.assign(media, { matches: false }); media.dispatchEvent(new Event('change')) })
  paint()
  expect(rollOf(container)).toBeNull()
})

it.each([
  [{ value: 999 }, '999'],
  [{ value: 1000 }, '1,000'],
  [{ value: 9.25, unit: 'kg' }, '9.25'],
  [{ value: -2.5, unit: '%' }, '-2.5'],
  [{ value: 2, signed: true }, '+2'],
  [{ valueText: '18 / 20人' }, '18 / 20人'],
  [{ valueRange: { from: 9.2, to: 9.4 }, unit: 'kg' }, '9.2 → 9.4'],
] as const)('桁数・小数・符号・単位・範囲を保持する %s', (overrides, expected) => {
  const { container, rerender } = render(view(undefined, overrides))
  paint()
  expect(numberOf(container)?.textContent).toBe(expected)
  const decoration = rollOf(container)
  expect(decoration).not.toBeNull()
  // 列の最後だけを読めば、小数点・区切り・単位を含む最終の文字と一致する。
  expect(Array.from(decoration!.children, node => node.firstElementChild?.lastElementChild?.textContent ?? node.textContent).join('')).toBe(expected)
  finish(container)
  rerender(view(undefined, { value: null }))
  paint()
  expect(numberOf(container)?.textContent).toBe('—')
  expect(rollOf(container)).toBeNull()
})

it('連続更新中も最新値と内訳の操作を保つ', () => {
  const onClick = vi.fn()
  const valueAction = { label: '内訳を見る', expanded: false, onClick }
  const { container, rerender, getByRole } = render(view(undefined, { valueAction }))
  paint()
  rerender(view(undefined, { value: 9, valueAction }))
  rerender(view(undefined, { value: 10, valueAction }))
  paint()
  fireEvent.click(getByRole('button', { name: '内訳を見る' }))
  expect(onClick).toHaveBeenCalledOnce()
  expect(numberOf(container)?.textContent).toBe('10')
})

it('画面の読み込み完了までは演出を始めず、破棄時に待機を解除する', () => {
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
  const { container, unmount } = render(view())
  paint()
  expect(rollOf(container)).toBeNull()
  act(() => { window.dispatchEvent(new Event('load')) })
  paint()
  expect(rollOf(container)).not.toBeNull()
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('StrictModeでも初回の装飾を一度開始し、条件がない利用先は静止する', () => {
  const { container, unmount } = render(<StrictMode>{view()}</StrictMode>)
  paint()
  expect(rollOf(container)).not.toBeNull()
  unmount()
  const plain = render(<KpiCard {...props} />)
  paint()
  expect(numberOf(plain.container)?.textContent).toBe('1,234')
  expect(rollOf(plain.container)).toBeNull()
})

it('期間を明示しない共通利用先は初回だけ回し、更新理由を推測しない', () => {
  const outer = (value: number) => <KpiValueMotionProvider scope="a" updates={false}><KpiCard {...props} value={value} /></KpiValueMotionProvider>
  const { container, rerender } = render(outer(1))
  paint()
  expect(rollOf(container)).not.toBeNull()
  finish(container)
  rerender(outer(2))
  paint()
  expect(numberOf(container)?.textContent).toBe('2')
  expect(rollOf(container)).toBeNull()
})

it('アカウント切替で内側の画面を作り直しても、初回として回さない', () => {
  const outer = (account: string) => <KpiValueMotionProvider scope={account} updates={false}>
    <KpiValueMotionProvider key={account} scope={`${account}:today`}><KpiCard {...props} /></KpiValueMotionProvider>
  </KpiValueMotionProvider>
  const { container, rerender } = render(outer('a'))
  paint()
  expect(rollOf(container)).not.toBeNull()
  rerender(outer('b'))
  paint()
  expect(numberOf(container)?.textContent).toBe('1,234')
  expect(rollOf(container)).toBeNull()
})

it('未選択から最初のアカウントが確定して値が届くと回す', () => {
  const { container, rerender } = render(view(null, { loading: true, value: null }))
  rerender(view('a:today', { value: 5 }))
  expect(numberOf(container)?.textContent).toBe('5')
  paint()
  expect(rollOf(container)).not.toBeNull()
})

it('非表示のマスは回さず、最初に表示したときに回す', () => {
  const { container, rerender } = render(view(undefined, { hidden: true }))
  paint()
  expect(rollOf(container)).toBeNull()
  rerender(view(undefined, { hidden: false }))
  paint()
  expect(rollOf(container)).not.toBeNull()
})

it('単位の補足が変わっても、同じ数値を回し直さない', () => {
  const { container, rerender } = render(view(undefined, { value: 3, unit: '組・5人' }))
  paint(); finish(container)
  rerender(view(undefined, { value: 3, unit: '組・6人' }))
  paint()
  expect(rollOf(container)).toBeNull()
  expect(container.querySelector('[data-kpi-unit]')?.textContent).toBe('組・6人')
})

it('画面の残りが読み込み中の間も実値を出し、読み込み完了後に装飾を始める', async () => {
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  const page = (busy: boolean) => <main><section aria-busy={busy || undefined}>表の読み込み</section>{view()}</main>
  const { container, rerender } = render(page(true))
  paint()
  expect(numberOf(container)?.textContent).toBe('1,234')
  expect(rollOf(container)).toBeNull()
  await act(async () => { rerender(page(false)); await Promise.resolve() })
  paint()
  expect(rollOf(container)).not.toBeNull()
})
