// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import MessageInsertRow, { MessageBody, MessageInsertButton } from './message-insert-row'
import { Field } from './form-controls'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('本文の中で文字数を1つだけ表示し、狭い幅でもその他の項目を操作できる', async () => {
  let resize: (entries: unknown[]) => void = () => {}
  vi.stubGlobal('ResizeObserver', class { cb: typeof resize; constructor(cb: typeof resize) { this.cb = cb } observe(el: Element) { if (el.matches('[data-message-body]')) resize = this.cb } disconnect() {} })
  const insert = vi.fn()
  render(<Field label="本文"><MessageBody><textarea aria-label="本文" defaultValue="こんにちは" maxLength={5000} /><MessageInsertRow count="5 / 5,000" more={<MessageInsertButton kind="date" label="配信日" onClick={() => insert('{{date}}')} />}><MessageInsertButton kind="name" label="名前" onClick={() => insert('{{name}}')} /></MessageInsertRow></MessageBody></Field>)
  expect(screen.getAllByText('5 / 5,000')).toHaveLength(1)
  expect(screen.getByRole('button', { name: '配信日' })).toBeTruthy()
  act(() => resize([{ contentRect: { width: 400 } }]))
  expect(screen.queryByRole('button', { name: '配信日' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'その他' }))
  fireEvent.click(await screen.findByRole('button', { name: '配信日' }))
  expect(insert).toHaveBeenCalledWith('{{date}}')
  act(() => resize([{ contentRect: { width: 800 } }]))
  expect(screen.queryByRole('button', { name: 'その他' })).toBeNull()
  expect(screen.getByRole('button', { name: '配信日' })).toBeTruthy()
})
