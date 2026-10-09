// @vitest-environment happy-dom
/* B-139：来店スタンプの小窓。決めるで落ちた欄は、その欄が赤くなり真下に理由が出て、1つ目の欄へ移る。打つ途中は出さない。 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MultiplierDialog, RewardDialog } from './dialogs'

afterEach(cleanup)
const frame = () => act(async () => { await new Promise((r) => requestAnimationFrame(r)) })

it('特典：空のまま足すと、名前と個数の欄に理由が出て名前へ移り、保存しない。打ち始めでは出さない', async () => {
  const onSave = vi.fn()
  render(<RewardDialog open reward={null} onClose={() => {}} onSave={onSave} />)
  const name = document.getElementById('vs-reward-name') as HTMLInputElement
  fireEvent.change(name, { target: { value: 'ド' } })
  expect(document.getElementById('vs-reward-stamps-error')).toBeNull()
  fireEvent.change(name, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '足す' }))
  await frame()
  expect(onSave).not.toHaveBeenCalled()
  expect(name.getAttribute('aria-invalid')).toBe('true')
  expect(document.getElementById('vs-reward-name-error')?.textContent).toBe('特典の名前を入れてください。')
  expect(document.getElementById('vs-reward-stamps-error')?.textContent).toBe('何個で使えるかを 1 以上の数で入れてください。')
  expect(document.activeElement).toBe(name)
})

it('倍率：倍率が範囲外なら倍率の欄に理由を出して移る', async () => {
  const onSave = vi.fn()
  render(<MultiplierDialog open multiplier={null} onClose={() => {}} onSave={onSave} />)
  const rate = document.getElementById('vs-mul-rate') as HTMLInputElement
  fireEvent.change(rate, { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: '足す' }))
  await frame()
  expect(onSave).not.toHaveBeenCalled()
  expect(document.getElementById('vs-mul-rate-error')?.textContent).toBe('倍率は 1〜100 で入れてください。')
  expect(document.activeElement).toBe(rate)
})
