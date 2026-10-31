// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { setTestReducedMotion } from '@/test-utils/reduced-motion'
import StyleSettingDemo from './style-setting-demo'

afterEach(() => { cleanup(); vi.useRealTimers() })
it('操作が進み、停止と場面の指定ができる', () => {
  setTestReducedMotion(false); vi.useFakeTimers()
  render(<StyleSettingDemo style="restaurant" />)
  expect(screen.getByText('座席・卓管理を開く', { selector: 'strong' })).toBeTruthy()
  act(() => { vi.advanceTimersByTime(2800) })
  expect(screen.getByText('卓を作る', { selector: 'strong' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '止める' }))
  act(() => { vi.advanceTimersByTime(10000) })
  expect(screen.getByText('卓を作る', { selector: 'strong' })).toBeTruthy()
  expect(screen.getByRole('progressbar', { name: '操作の進み' }).getAttribute('value')).toBe('2')
})
it('動きを減らすと最後の場面を表示する', () => {
  setTestReducedMotion(true)
  render(<StyleSettingDemo style="standard" />)
  expect(screen.getByText('変更を保存する', { selector: 'strong' })).toBeTruthy()
  expect(screen.queryByText('自動再生なし')).toBeNull()
  expect(screen.getByText(/実際の入力や保存は行いません/)).toBeTruthy()
})
