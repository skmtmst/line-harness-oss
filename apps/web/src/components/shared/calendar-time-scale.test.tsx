// @vitest-environment happy-dom
import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CalendarTimeEntries, useCalendarTimeScale } from './calendar-parts'
import { BookingBlock } from './booking-controls'
import { BookingName, BookingSummary } from './booking-presentation'

const day = '2026-10-21'
const entry = (id: string, start: string, end: string) => ({ id, day, start, end, title: `予約${id}`, name: `名前${id}` })
const style = { '--tpl-sd-week-hour': '48px', '--tpl-sd-entry-gap': '4px' } as React.CSSProperties
function Grid({ entries = [entry('a', '10:00', '10:15'), entry('b', '10:15', '10:45')], free = [] as Array<{ day: string; start: string; end: string }>, canWrite = true }) {
  const ref = useCalendarTimeScale(entries, free, canWrite)
  return <section ref={ref} style={style} aria-label="時刻盤"><CalendarTimeEntries days={[day]} entries={entries} free={free} canWrite={canWrite} position={() => ({})} onOpen={() => {}} onSlot={() => {}} /></section>
}
beforeEach(() => {
  const actual = window.getComputedStyle.bind(window)
  vi.stubGlobal('getComputedStyle', (element: Element) => {
    const resolved = actual(element)
    if (!element.matches('button[data-placement="calendar"], button[data-placement="board"]')) return resolved
    // happy-dom does not lay out CSS modules. Supply the native control's resolved vertical metrics.
    const vertical: Record<string, string> = { flexDirection: element.hasAttribute('data-calendar-slot') ? 'row' : 'column', paddingTop: '8px', paddingBottom: '8px', borderTopWidth: '0px', borderBottomWidth: '0px', rowGap: '0px' }
    return new Proxy(resolved, { get: (target, key) => vertical[String(key)] ?? Reflect.get(target, key) })
  })
  // CSS Modulesを配置しない環境でも、札の名前・時刻の各行と空き枠の文字に実際の1行高を与える。
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function () {
    return this.parentElement?.matches('button[data-placement="calendar"], button[data-placement="board"]') && this.textContent ? 17 : 0
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('共通時間盤の表示倍率', () => {
  it('担当の盤も短い予約の名前と時刻を収め、盤専用の時間軸だけを伸ばす', async () => {
    const entries = [entry('a', '10:00', '10:15'), entry('b', '10:15', '10:45')]
    function Board() {
      const ref = useCalendarTimeScale(entries, [], false, 'board')
      return <section ref={ref} aria-label="担当の盤" style={{ '--tpl-sd-hour': '52px', '--tpl-sd-entry-gap': '4px' } as React.CSSProperties}>{entries.map(item =>
        <BookingBlock key={item.id} placement="board"><BookingName>{item.name}</BookingName><BookingSummary time={`${item.start}〜${item.end}`}>{item.title}</BookingSummary></BookingBlock>,
      )}</section>
    }
    const view = render(<Board />)
    const board = screen.getByRole('region', { name: '担当の盤' })
    await waitFor(() => expect(board.style.getPropertyValue('--tpl-sd-hour')).toBe('216px'))
    expect(board.style.getPropertyValue('--tpl-sd-week-hour')).toBe('')
    view.unmount()
    expect(board.style.getPropertyValue('--tpl-sd-hour')).toBe('52px')
  })

  it('15分と隣の30分が同じ倍率で実時刻に比例し、2行の本文と余白を収める', async () => {
    render(<Grid />)
    const grid = screen.getByRole('region', { name: '時刻盤' })
    await waitFor(() => expect(grid.style.getPropertyValue('--tpl-sd-week-hour')).toBe('216px'))
    const hour = Number.parseFloat(grid.style.getPropertyValue('--tpl-sd-week-hour'))
    expect(hour * 15 / 60 - 4).toBe(50)
    expect(hour * 30 / 60 - 4).toBe(104)
    expect(hour * 15 / 60).toBeGreaterThan(hour * 15 / 60 - 4)
    expect(screen.getByRole('button', { name: '10:00〜10:15 予約a 名前a' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '10:15〜10:45 予約b 名前b' })).toBeTruthy()
  })

  it('自由枠の短い間隔も含め、権限がなくなれば非表示の空きで倍率を変えない', async () => {
    const entries = [entry('a', '10:00', '12:00')], free = [{ day, start: '12:00', end: '12:15' }]
    const view = render(<Grid entries={entries} free={free} />)
    const grid = screen.getByRole('region', { name: '時刻盤' })
    await waitFor(() => expect(grid.style.getPropertyValue('--tpl-sd-week-hour')).toBe('216px'))
    view.rerender(<Grid entries={entries} free={free} canWrite={false} />)
    await waitFor(() => expect(grid.style.getPropertyValue('--tpl-sd-week-hour')).toBe('48px'))
    expect(screen.queryByRole('button', { name: /に予約を入れる/ })).toBeNull()
  })

  it('通常の長い枠では拡大せず、再計測が倍率を累積させない', async () => {
    const view = render(<Grid entries={[entry('a', '10:00', '12:00')]} />)
    const grid = screen.getByRole('region', { name: '時刻盤' })
    await waitFor(() => expect(grid.style.getPropertyValue('--tpl-sd-week-hour')).toBe('48px'))
    view.rerender(<Grid />)
    await waitFor(() => expect(grid.style.getPropertyValue('--tpl-sd-week-hour')).toBe('216px'))
    fireEvent(window, new Event('resize'))
    await waitFor(() => expect(grid.style.getPropertyValue('--tpl-sd-week-hour')).toBe('216px'))
  })

  it('StrictModeとunmountで元の値を戻し、resizeの購読と予約済み計測を残さない', async () => {
    const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener')
    const view = render(<StrictMode><Grid /></StrictMode>)
    const grid = screen.getByRole('region', { name: '時刻盤' })
    await waitFor(() => expect(grid.style.getPropertyValue('--tpl-sd-week-hour')).toBe('216px'))
    fireEvent(window, new Event('resize'))
    view.unmount()
    await Promise.resolve()
    expect(grid.style.getPropertyValue('--tpl-sd-week-hour')).toBe('48px')
    const listeners = add.mock.calls.filter(([event]) => event === 'resize').map(([, listener]) => listener)
    for (const listener of listeners) expect(remove.mock.calls.some(([event, removed]) => event === 'resize' && removed === listener)).toBe(true)
  })
})
