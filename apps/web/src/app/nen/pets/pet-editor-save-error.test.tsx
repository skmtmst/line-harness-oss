// @vitest-environment happy-dom
/*
 * M511フォロー：保存500の案内（保存catch → describeSaveFailure → drawerの帯）。
 * root実GUIで exact合成PUT500 が「API error: 500」とだけ出た残り。
 * 409 VERSION_CONFLICT の日本語案内・入力保持・版の更新（M511既存の動き）は触らない。
 */
import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { NenPetRow } from '@/lib/nen-pets-api'

const updatePet = vi.fn()

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      nenCampaigns: {
        ...actual.api.nenCampaigns,
        updatePet,
      },
    },
  }
})

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { default: PetEditor } = await import('./pet-editor')
// mock済みだが ApiError・describeSaveFailure は本物（…actual 引き継ぎ）。
const { ApiError } = await import('@/lib/api')

function row(): NenPetRow {
  return {
    id: 'pet-1', name: 'ポチ', callName: 'ポチくん', gender: 'male', animalType: 'dog',
    breed: '柴犬', birthday: '2020-03-15', ageLabel: '6歳', weightKg: 8,
    neutered: 'yes', activityLevel: 'normal', activityLabel: 'ふつう',
    productName: '鹿肉フード', feeding: null, imageUrl: null,
    updatedAt: 'v1', weightUpdatedAt: '2020-03-15', weightStale: false,
    owner: { friendId: 'f-1', name: '飼い主', pictureUrl: null, customerId: null },
  }
}

afterEach(() => {
  cleanup()
  updatePet.mockReset()
})

describe('M511フォロー 保存500の案内', () => {
  test('PUT500（本文なし）は運用者向け日本語を出し、生の API error:500 を出さない', async () => {
    updatePet.mockRejectedValueOnce(new ApiError(500))
    await act(async () => {
      render(<PetEditor accountId="a1" pet={row()} onClose={() => {}} onSaved={() => {}} />)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    })
    await waitFor(() => {
      expect(screen.getByText(/サーバー側で保存できませんでした/)).toBeTruthy()
    })
    expect(screen.queryByText(/API error:/)).toBeNull()
  })

  test('409 VERSION_CONFLICT は既存の日本語案内・入力保持のまま（M511保持）', async () => {
    updatePet.mockRejectedValueOnce(
      new ApiError(409, undefined, 'VERSION_CONFLICT', { latest: { updatedAt: 'v2' } }),
    )
    await act(async () => {
      render(<PetEditor accountId="a1" pet={row()} onClose={() => {}} onSaved={() => {}} />)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    })
    await waitFor(() => {
      expect(screen.getByText(/ほかの人が先にペットの情報を変えました/)).toBeTruthy()
    })
    // 入力は残る。
    expect(screen.getByLabelText('ペットの名前')).toHaveProperty('value', 'ポチ')
    expect(screen.queryByText(/API error:/)).toBeNull()
  })
})
