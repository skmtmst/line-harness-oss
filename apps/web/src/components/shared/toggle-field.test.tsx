// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ToggleField, ToggleGroupActions } from './toggle'
import { Field } from './form-controls'

afterEach(cleanup)

test('一部オンの件数を示し、オンとオフを明示して一括変更する', () => {
  const change = vi.fn()
  render(<ToggleGroupActions total={6} enabled={4} label="配信" onChange={change} />)
  expect(screen.getByText('6 件中 4 件オン')).toBeTruthy()
  expect(screen.queryByRole('switch')).toBeNull()
  for (const button of screen.getAllByRole('button')) {
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe('6 件中 4 件オン')
  }
  fireEvent.click(screen.getByRole('button', { name: '配信をすべてオン' }))
  fireEvent.click(screen.getByRole('button', { name: '配信をすべてオフ' }))
  expect(change.mock.calls).toEqual([[true], [false]])
})

test('一括変更の反映中は操作を受け付けない', () => {
  const change = vi.fn()
  render(<ToggleGroupActions total={6} enabled={4} label="配信" disabled onChange={change} />)
  fireEvent.click(screen.getByRole('button', { name: '配信をすべてオン' }))
  fireEvent.click(screen.getByRole('button', { name: '配信をすべてオフ' }))
  expect(change).not.toHaveBeenCalled()
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
