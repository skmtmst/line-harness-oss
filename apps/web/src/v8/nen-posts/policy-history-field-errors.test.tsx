// @vitest-environment happy-dom
/* B-139：報酬の決まりの新しい版（N1br7）。保存で落ちた欄は、その欄が赤くなり真下に理由が出て、1つ目の欄へ移る。 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const create = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      nenMembers: {
        ...actual.api.nenMembers,
        photoRewardPolicyVersions: async () => ({ success: true, data: [] }),
        createPhotoRewardPolicyVersion: create,
      },
    },
  }
})

import PhotoPolicyHistoryV8 from './policy-history'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement
let root: Root
beforeEach(() => { document.documentElement.setAttribute('data-theme', 'v8'); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); create.mockReset() })
afterEach(() => { act(() => root.unmount()); host.remove(); document.documentElement.removeAttribute('data-theme') })

it('採用したらのマイルが空なら口を呼ばず、その欄が赤くなり理由が出て、そこへ移る', async () => {
  await act(async () => { root.render(<PhotoPolicyHistoryV8 open canEdit onClose={() => {}} onChanged={() => {}} />) })
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve() })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '新しい版を作る' })) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '版を保存する' })) })
  await act(async () => { await new Promise((r) => requestAnimationFrame(r)) })
  expect(create).not.toHaveBeenCalled()
  const points = document.getElementById('photo-policy-points') as HTMLInputElement
  expect(points.getAttribute('aria-invalid')).toBe('true')
  expect(document.getElementById('photo-policy-points-error')?.textContent).toBe('採用したら付けるマイルを1〜100000で入力してください。')
  expect(document.getElementById('photo-policy-publication-error')).toBeNull()
  expect(document.activeElement).toBe(points)
})
