// @vitest-environment happy-dom
/*
 * B-139：質問を作る（l87p1J）。保存で足りない欄は、その欄が赤くなり真下に理由が出て、
 * 1つ目の欄へ移る。上の帯だけで終わらせない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const templatesApi = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const api = (actual as unknown as { api: Record<string, object> }).api
  return {
    ...actual,
    api: {
      ...api,
      templates: { ...api.templates, ...templatesApi },
      folders: { ...api.folders, list: async () => ({ success: true, data: [] }) },
      tags: { ...api.tags, list: async () => ({ success: true, data: [] }) },
      scenarios: { ...api.scenarios, list: async () => ({ success: true, data: [] }) },
    },
  }
})
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => React.createElement('a', { href, ...rest }, children),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: '然 - NEN -' }], loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-capability', () => ({ isOwnerOrAdmin: () => true }))
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => false }))

import QuestionNewV8 from './question-new'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

async function frames(count = 3) {
  for (let i = 0; i < count; i += 1) await act(async () => { await new Promise((r) => requestAnimationFrame(r)) })
}

beforeEach(async () => {
  document.documentElement.setAttribute('data-theme', 'v8')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  for (const fn of Object.values(templatesApi)) fn.mockReset()
  await act(async () => { root.render(<QuestionNewV8 />) })
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve() })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.documentElement.removeAttribute('data-theme')
})

describe('質問を作る：保存で欄に知らせる（B-139）', () => {
  it('空のまま保存すると、名前・質問文・選択肢の欄が赤くなり理由が出て、名前の欄へ移る。直すと消える', async () => {
    // 2つ目の選択肢の文字を消しておく（はい・いいえ が最初から入っている）。
    const choiceInputs = Array.from(document.querySelectorAll('input[maxlength="20"]')) as HTMLInputElement[]
    fireEvent.change(choiceInputs[1], { target: { value: '' } })
    const save = screen.getByRole('button', { name: '下書きを保存' })
    await act(async () => { fireEvent.click(save) })
    await frames()
    expect(templatesApi.create).not.toHaveBeenCalled()
    const name = document.querySelector('input[placeholder="例：継続の意思をうかがう"]') as HTMLInputElement
    const text = document.querySelector('input[placeholder="来月も定期便を続けますか？"]') as HTMLInputElement
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(text.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById('q-name-error')?.textContent).toBe('テンプレート名を入力してください。')
    expect(document.getElementById('q-text-error')?.textContent).toBe('質問文を入力してください。')
    expect(document.getElementById('q-choice-0-error')).toBeNull()
    expect(document.getElementById('q-choice-1-error')?.textContent).toBe('ボタンの文字を入力してください。')
    expect(choiceInputs[1].getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(name)
    expect(document.querySelector('[data-design-part="validation-summary"]')?.textContent).toContain('3か所直してください：テンプレート名・質問文・選択肢 2 のボタンの文字')
    fireEvent.change(name, { target: { value: '継続のうかがい' } })
    expect(name.getAttribute('aria-invalid')).toBeNull()
    expect(document.getElementById('q-name-error')).toBeNull()
  })
})
