// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { Field } from './form-controls'
import ComposerStickers, { STICKER_IMAGE_PATHS, STICKER_LABELS } from './composer-stickers'
import { SaveErrorScope, useSaveFormErrors } from './save-form-errors'

afterEach(cleanup)
const fields = { mode: ['stickerMode'], packageId: ['packageId'], stickerId: ['stickerId'] }

it('値に追従する指定は、後から戻したパックの選択を表示する', () => {
  const view = render(<ComposerStickers value={{ packageId: '446', stickerId: '1988' }} onChange={() => {}} syncSelection />)
  expect(screen.getByRole('button', { name: 'スタンプ 1988' }).getAttribute('aria-pressed')).toBe('true')
  view.rerender(<ComposerStickers value={{ packageId: '789', stickerId: '10855' }} onChange={() => {}} syncSelection />)
  expect(screen.getByRole('button', { name: 'スタンプ 10855' }).getAttribute('aria-pressed')).toBe('true')
})

it('指定した画像の置き場を順に試し、全て失敗しても分かる名前を残す', () => {
  render(<ComposerStickers value={{ packageId: '789', stickerId: '10855' }} onChange={() => {}} labels={STICKER_LABELS} imagePaths={STICKER_IMAGE_PATHS} />)
  const image = screen.getByRole('img', { name: 'OK', exact: true })
  expect(image.getAttribute('src')).toContain('/android/sticker.png')
  fireEvent.error(image)
  expect(image.getAttribute('src')).toContain('/iPhone/sticker@2x.png')
  fireEvent.error(image)
  const button = screen.getByRole('button', { name: 'OK', exact: true })
  expect(button.textContent).toBe('OK')
  expect(button.getAttribute('aria-pressed')).toBe('true')
})

function Form({ field }: { field: 'packageId' | 'stickerId' }) {
  const errors = useSaveFormErrors()
  return <SaveErrorScope errors={errors}>
    <ComposerStickers value={{ packageId: '446', stickerId: '1988' }} onChange={() => {}} fieldNames={fields} syncSelection />
    <button onClick={() => errors.capture({ status: 422, fields: { [field]: '番号を確認してください' } })}>失敗を確かめる</button>
  </SaveErrorScope>
}
it.each([['packageId', 'パッケージID'], ['stickerId', 'スタンプID']] as const)('%sの失敗は畳まれた欄を開いて該当する入力へ移り、理由を結ぶ', async (field, label) => {
  const view = render(<Field label=""><Form field={field} /></Field>)
  expect(screen.queryByRole('textbox')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '失敗を確かめる' }))
  const input = await screen.findByRole('textbox', { name: label, exact: true })
  await waitFor(() => expect(document.activeElement).toBe(input))
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(input.getAttribute('aria-required')).toBe('true')
  expect((input as HTMLInputElement).required).toBe(false)
  const note = screen.getByText('番号を確認してください')
  expect(note.closest('label')).toBeNull()
  expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(note.id)
  const ids = [...view.container.querySelectorAll('[id]')].map(e => e.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(view.container.querySelectorAll('[data-required-badge]').length).toBe(2)
})

it('別のパックを読んだ後でも、同じパックの別スタンプを戻すと選択印を表示する', () => {
  const view = render(<ComposerStickers value={{ packageId: '446', stickerId: '1988' }} onChange={() => {}} syncSelection />)
  fireEvent.click(screen.getByRole('button', { name: 'ブラウン＆コニー' }))
  view.rerender(<ComposerStickers value={{ packageId: '446', stickerId: '1989' }} onChange={() => {}} syncSelection />)
  expect(screen.getByRole('button', { name: 'スタンプ 1989' }).getAttribute('aria-pressed')).toBe('true')
})
