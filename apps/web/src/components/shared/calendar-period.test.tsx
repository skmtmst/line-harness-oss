// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import CalendarPeriod from './calendar-period'
import { setTestReducedMotion } from '@/test-utils/reduced-motion'

afterEach(() => { cleanup(); vi.restoreAllMocks(); document.documentElement.style.cssText = '' })

it('次の期間は右から、前の期間は左から入り、連打で前の動きを中断する', () => {
  setTestReducedMotion(false)
  document.documentElement.style.setProperty('--motion-base', '200ms')
  document.documentElement.style.setProperty('--polish-space-card', '20px')
  const cancel = vi.fn(), animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => ({ cancel }))
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  const onClick = vi.fn()
  const view = render(<CalendarPeriod period="2026-10"><button onClick={onClick}>予約を開く</button></CalendarPeriod>)
  expect(animate).not.toHaveBeenCalled()
  view.rerender(<CalendarPeriod period="2026-11"><button onClick={onClick}>予約を開く</button></CalendarPeriod>)
  expect(animate.mock.calls[0][0]).toEqual([{ transform: 'translateX(20px)' }, { transform: 'translateX(0)' }])
  expect(animate.mock.calls[0][1]).toMatchObject({ duration: 200 })
  fireEvent.click(screen.getByRole('button'))
  expect(onClick).toHaveBeenCalledOnce()
  view.rerender(<CalendarPeriod period="2026-10"><button onClick={onClick}>予約を開く</button></CalendarPeriod>)
  expect(cancel).toHaveBeenCalledOnce()
  expect(animate.mock.calls[1][0]).toEqual([{ transform: 'translateX(calc(20px * -1))' }, { transform: 'translateX(0)' }])
})

it('動きを減らす設定・同じ期間の再取得・表示方式の変更では動かさない', () => {
  const animate = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  const view = render(<CalendarPeriod period="2026-10" scope="month">10月</CalendarPeriod>)
  view.rerender(<CalendarPeriod period="2026-11" scope="month">11月</CalendarPeriod>)
  expect(screen.getByText('11月')).toBeTruthy()
  setTestReducedMotion(false)
  view.rerender(<CalendarPeriod period="2026-11" scope="month">11月・更新済み</CalendarPeriod>)
  view.rerender(<CalendarPeriod period="2026-12" scope="week">12月・週表示</CalendarPeriod>)
  expect(animate).not.toHaveBeenCalled()
})

it('期間変更の読み込みを挟んでも直前の期間から向きを決め、入れ子では動きを重ねない', () => {
  setTestReducedMotion(false)
  document.documentElement.style.setProperty('--motion-base', '200ms')
  document.documentElement.style.setProperty('--polish-space-card', '20px')
  const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => ({ cancel: vi.fn() }))
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  const view = render(<CalendarPeriod period="2026-10"><CalendarPeriod period="2026-10">10月</CalendarPeriod></CalendarPeriod>)
  view.rerender(<CalendarPeriod period="">読み込んでいます</CalendarPeriod>)
  view.rerender(<CalendarPeriod period="2026-11"><CalendarPeriod period="2026-11">11月</CalendarPeriod></CalendarPeriod>)
  expect(animate).toHaveBeenCalledOnce()
  expect(animate.mock.calls[0][0][0]).toEqual({ transform: 'translateX(20px)' })
})
