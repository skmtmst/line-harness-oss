// @vitest-environment happy-dom
/* B-139：ペットの情報を直す窓（eLjeQ）。保存で落ちた欄は、その欄が赤くなり真下に理由が出て、1つ目の欄へ移る。 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const updatePet = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return { ...actual, api: { ...actual.api, nenCampaigns: { ...actual.api.nenCampaigns, updatePet } } }
})

import PetEditorV8 from './editor'
import type { NenPetRow } from '@/lib/nen-pets-api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement
let root: Root
beforeEach(() => { document.documentElement.setAttribute('data-theme', 'v8'); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); updatePet.mockReset() })
afterEach(() => { act(() => root.unmount()); host.remove(); document.documentElement.removeAttribute('data-theme') })

const pet = {
  id: 'p1', name: 'ポチ', callName: 'ポチくん', gender: 'male', animalType: 'dog', breed: '柴', birthday: null, ageLabel: '', weightKg: 9.2,
  neutered: 'unknown', activityLevel: 'normal', activityLabel: '', productName: null, feeding: null, imageUrl: null, updatedAt: 'v1',
  weightUpdatedAt: '', weightStale: false, owner: { friendId: 'f', name: '山田', pictureUrl: null, customerId: null },
} as unknown as NenPetRow

it('名前が空・体重が範囲外なら口を呼ばず、2つの欄が赤くなり、名前の欄へ移る', async () => {
  await act(async () => { root.render(<PetEditorV8 accountId="a" pet={pet} onClose={() => {}} onSaved={() => {}} />) })
  fireEvent.change(screen.getByLabelText('ペットの名前'), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText('体重'), { target: { value: '500' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存する' })) })
  await act(async () => { await new Promise((r) => requestAnimationFrame(r)) })
  expect(updatePet).not.toHaveBeenCalled()
  const name = screen.getByLabelText('ペットの名前')
  expect(name.getAttribute('aria-invalid')).toBe('true')
  expect(document.getElementById('pet-name-error')?.textContent).toBe('ペットの名前を入れてください。')
  expect(screen.getByLabelText('体重').getAttribute('aria-invalid')).toBe('true')
  expect(document.getElementById('pet-weight-error')?.textContent).toBe('体重は 0.01〜200kg で入力してください。')
  expect(document.activeElement).toBe(name)
})
