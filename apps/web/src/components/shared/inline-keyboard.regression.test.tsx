// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import InlineEdit from './inline-edit'
import DetailPanel from './detail-panel'
afterEach(cleanup)

it.each([{ isComposing: true }, { keyCode: 229 }])('引継ぎ9: IME %j のEnterは保存せず、通常のEnterで一度保存', async (ime) => {
  const save = vi.fn().mockResolvedValue(undefined)
  render(<InlineEdit value="秋" label="名前" onSave={save} />)
  fireEvent.click(screen.getByRole('button', { name: '名前を変更する' }))
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: '冬' } })
  fireEvent.keyDown(input, { key: 'Enter', ...ime })
  expect(save).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox')).toBe(input)
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
  expect(save).toHaveBeenCalledExactlyOnceWith('冬')
})
it('引継ぎ9: 保存中のEscは編集を閉じず、保存終了を待つ', async () => {
  let finish!: () => void
  const save = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
  render(<InlineEdit value="秋" label="名前" onSave={save} />)
  fireEvent.click(screen.getByRole('button', { name: '名前を変更する' }))
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: '冬' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(screen.getByRole('textbox')).toBe(input)
  expect(screen.getByRole('status').textContent).toContain('保存中')
  await act(async () => { finish() })
  expect(screen.queryByRole('textbox')).toBeNull()
})
it('引継ぎ9: 処理済みのArrowDownと保存中のEscを詳細パネルが横取りしない', () => {
  const next = vi.fn(), close = vi.fn()
  const view = render(<DetailPanel open title="詳細" onClose={close} onNext={next} hasNext>
    <button onKeyDown={(event) => event.preventDefault()}>候補</button>
  </DetailPanel>)
  fireEvent.keyDown(screen.getByRole('button', { name: '候補' }), { key: 'ArrowDown' })
  expect(next).not.toHaveBeenCalled()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowDown' })
  expect(next).toHaveBeenCalledTimes(1)
  view.rerender(<DetailPanel open title="詳細" onClose={close} busy />)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(close).not.toHaveBeenCalled()
})
