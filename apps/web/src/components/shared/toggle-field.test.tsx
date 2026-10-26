// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import Toggle, { ToggleField } from './toggle'
import { Field } from './form-controls'

afterEach(cleanup)

test.each([false, true])('一部オンはchecked=%sでも全オンへ切り替える', checked => {
  const change = vi.fn()
  render(<Toggle checked={checked} indeterminate label="まとめて" onChange={change} />)
  fireEvent.click(screen.getByRole('switch', { name: 'まとめて' }))
  expect(change).toHaveBeenCalledWith(true)
  expect(screen.getByRole('switch').getAttribute('aria-description')).toBe('一部だけオンです')
})

test('設定の説明と外のFieldの説明を保ち、ラベルを押して切り替えられる', () => {
  const change = vi.fn()
  render(<Field label="通知" note="保存するまで反映されません"><ToggleField checked={false} description="前日の夕方に送ります" onChange={change}>前日に知らせる</ToggleField></Field>)
  const toggle = screen.getByRole('switch', { name: '前日に知らせる' })
  const descriptions = (toggle.getAttribute('aria-describedby') ?? '').split(/\s+/).map(id => document.getElementById(id)?.textContent)
  expect(descriptions).toContain('前日の夕方に送ります')
  expect(descriptions).toContain('保存するまで反映されません')
  fireEvent.click(screen.getByText('前日に知らせる'))
  expect(change).toHaveBeenCalledWith(true)
})

test('操作できない設定はラベルからも変更せず、オンを保つ', () => {
  const change = vi.fn()
  render(<ToggleField checked locked onChange={change}>常に知らせる</ToggleField>)
  fireEvent.click(screen.getByText('常に知らせる'))
  expect(change).not.toHaveBeenCalled()
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  expect(screen.getByRole('switch').getAttribute('aria-description')).toContain('いつもオン')
})
