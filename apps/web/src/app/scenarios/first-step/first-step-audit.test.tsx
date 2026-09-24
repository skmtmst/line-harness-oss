// @vitest-environment happy-dom
/*
 * SCENARIO-01〜05 の回帰試験（1通目画面）。
 *
 * - 01：offsetMinutes=90 の既存1通目を開いてそのまま保存しても 90 のまま
 * - 02：画像の既存1通目がアップローダへ復元され、再登録なしで保存できる
 * - 03：詳細条件を選んだのに未設定なら保存を止める（全員は明示選択だけ）
 * - 04：シナリオ取得中・取得失敗では追加/更新APIを呼ばない
 * - 05：保存の例外で「保存中」のままにならず、入力を残して再試行できる
 *
 * あわせて、id 切替後に古い応答が上書きしないこと（SCENARIO-11 の1通目側）も見る。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  get: vi.fn(),
  tags: vi.fn(),
  templates: vi.fn(),
  addStep: vi.fn(),
  updateStep: vi.fn(),
  push: vi.fn(),
  invalidate: vi.fn(),
  params: new URLSearchParams('id=sc-a'),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => m.params,
  useRouter: () => ({ push: m.push }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...p }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...p}>
      {children}
    </a>
  ),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message?: string) {
      super(message || `API error: ${status}`)
      this.status = status
    }
  },
  api: {
    scenarios: {
      get: m.get,
      addStep: m.addStep,
      updateStep: m.updateStep,
    },
  },
}))
vi.mock('@/components/scenarios/scenario-reference-data', () => ({
  scenarioReferenceData: {
    scenario: m.get,
    tags: m.tags,
    templates: m.templates,
    invalidateScenario: m.invalidate,
  },
}))
vi.mock('@/components/shared/condition-builder', () => ({
  default: () => null,
  isEmptyCondition: (v: unknown) => !v,
  pruneCondition: (v: unknown) => v,
}))
vi.mock('@/components/shared/image-uploader', () => ({
  default: ({ value }: { value: unknown }) => (
    <div data-testid="image-value">{JSON.stringify(value)}</div>
  ),
}))
vi.mock('@/components/scenarios/insert-toolbar', () => ({ default: () => null }))
vi.mock('@/components/scenarios/step-preview', () => ({
  default: (p: Record<string, unknown>) => <pre data-testid="preview">{JSON.stringify(p)}</pre>,
}))
vi.mock('@/components/scenarios/carousel-picker', () => ({ default: () => null }))
vi.mock('@/components/scenarios/question-editor', () => ({
  default: () => null,
  emptyQuestion: () => ({ text: '', intro: '', choices: [] }),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'a', accounts: [{ id: 'a', name: '検証A' }] }),
}))

import FirstStep from '@/app/scenarios/first-step/page'

const ok = (data: unknown) => ({ success: true as const, data })
const fail = { success: false as const, error: '検証用エラー' }
const step = (p: Record<string, unknown> = {}) => ({
  id: 's1',
  scenarioId: 'sc-a',
  stepOrder: 1,
  messageType: 'text',
  messageContent: '監査用本文',
  delayMinutes: 0,
  offsetDays: 0,
  offsetMinutes: 90,
  deliveryTime: null,
  templateId: null,
  targetCondition: null,
  question: null,
  isDraft: false,
  createdAt: '2026-01-01T00:00:00Z',
  ...p,
})
const scenario = (p: Record<string, unknown> = {}) => ({
  id: 'sc-a',
  name: '検証シナリオA',
  deliveryMode: 'elapsed',
  isActive: false,
  triggerType: 'manual',
  steps: [step()],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...p,
})
const defer = <T,>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

async function mount(el: React.ReactNode) {
  await act(async () => {
    render(el)
  })
}
async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name, exact: true }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  m.params = new URLSearchParams('id=sc-a')
  m.get.mockResolvedValue(ok(scenario()))
  m.tags.mockResolvedValue(ok([]))
  m.templates.mockResolvedValue(ok([]))
  m.addStep.mockResolvedValue(ok({}))
  m.updateStep.mockResolvedValue(ok({}))
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})
afterEach(cleanup)

describe('SCENARIO-01：分の端数を丸めない', () => {
  it('offsetMinutes=90 の既存1通目をそのまま保存すると90のまま', async () => {
    await mount(<FirstStep />)
    // 日・時間・分の3欄に分かれて戻る（0日・1時間・30分）
    const numbers = screen.getAllByRole('spinbutton').map((el) => (el as HTMLInputElement).value)
    expect(numbers).toEqual(['0', '1', '30'])
    await click('作成して編集へ →')
    expect(m.updateStep).toHaveBeenCalledTimes(1)
    expect(m.updateStep.mock.calls[0][2].offsetMinutes).toBe(90)
  })

  it.each([1, 59, 60, 1439])('offsetMinutes=%i を往復保存しても同じ値', async (mins) => {
    m.get.mockResolvedValue(
      ok(scenario({ steps: [step({ offsetDays: 0, offsetMinutes: mins })] })),
    )
    await mount(<FirstStep />)
    await click('作成して編集へ →')
    expect(m.updateStep.mock.calls[0][2].offsetMinutes).toBe(mins)
  })

  it('relative の delayMinutes も日・時間・分へ分解して往復する', async () => {
    m.get.mockResolvedValue(
      ok(scenario({ deliveryMode: 'relative', steps: [step({ delayMinutes: 90, offsetMinutes: null })] })),
    )
    await mount(<FirstStep />)
    await click('作成して編集へ →')
    expect(m.updateStep.mock.calls[0][2].delayMinutes).toBe(90)
  })
})

describe('SCENARIO-02：既存の内容を入力欄へ復元する', () => {
  it('画像の1通目は再登録なしで保存できる', async () => {
    const content = JSON.stringify({
      originalContentUrl: 'https://example.test/a.jpg',
      previewImageUrl: 'https://example.test/a.jpg',
    })
    m.get.mockResolvedValue(
      ok(scenario({ steps: [step({ messageType: 'image', messageContent: content })] })),
    )
    await mount(<FirstStep />)
    expect(screen.getByTestId('image-value').textContent).toContain('https://example.test/a.jpg')
    await click('作成して編集へ →')
    expect(m.updateStep).toHaveBeenCalledTimes(1)
    expect(m.updateStep.mock.calls[0][2].messageContent).toBe(content)
  })

  it('読めない画像JSONは元の中身を保持して理由を出す', async () => {
    m.get.mockResolvedValue(
      ok(scenario({ steps: [step({ messageType: 'image', messageContent: 'not-json' })] })),
    )
    await mount(<FirstStep />)
    expect(screen.getByText(/読み取れませんでした/)).toBeTruthy()
    await click('作成して編集へ →')
    expect(m.updateStep.mock.calls[0][2].messageContent).toBe('not-json')
    expect(m.updateStep.mock.calls[0][2].messageType).toBe('image')
  })
})

describe('SCENARIO-03：詳細条件が未設定なら全員対象にしない', () => {
  it('詳細条件を選んだまま未設定だと保存せず理由を出す', async () => {
    m.get.mockResolvedValue(ok(scenario({ steps: [] })))
    await mount(<FirstStep />)
    fireEvent.click(screen.getByLabelText('詳細条件で絞り込んで配信する'))
    fireEvent.change(screen.getByPlaceholderText('はじめまして。友だち追加ありがとうございます。'), {
      target: { value: '本文' },
    })
    await click('作成して編集へ →')
    expect(m.addStep).not.toHaveBeenCalled()
    expect(screen.getByText(/詳細条件がまだ設定されていません/)).toBeTruthy()
  })

  it('全員を明示した場合だけ targetCondition:null を送る', async () => {
    m.get.mockResolvedValue(ok(scenario({ steps: [] })))
    await mount(<FirstStep />)
    fireEvent.click(screen.getByLabelText('詳細条件で絞り込んで配信する'))
    fireEvent.change(screen.getByPlaceholderText('はじめまして。友だち追加ありがとうございます。'), {
      target: { value: '本文' },
    })
    await click('作成して編集へ →')
    expect(m.addStep).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('シナリオ購読中の全員に配信する'))
    await click('作成して編集へ →')
    expect(m.addStep).toHaveBeenCalledTimes(1)
    expect(m.addStep.mock.calls[0][1].targetCondition).toBeNull()
  })
})

describe('SCENARIO-04：シナリオが確定するまで保存しない', () => {
  it('取得中はフォームと保存ボタンを出さず、追加APIも走らない', async () => {
    const slow = defer<unknown>()
    m.get.mockReturnValue(slow.promise)
    await mount(<FirstStep />)
    expect(screen.queryByRole('button', { name: '作成して編集へ →' })).toBeNull()
    expect(screen.getByText('シナリオを読み込んでいます…')).toBeTruthy()
    await act(async () => {
      slow.resolve(ok(scenario({ steps: [] })))
    })
    expect(screen.getByRole('button', { name: '作成して編集へ →' })).toBeTruthy()
  })

  it('取得失敗では保存できず、再読み込みで取り直せる', async () => {
    m.get.mockResolvedValueOnce(fail).mockResolvedValue(ok(scenario({ steps: [] })))
    await mount(<FirstStep />)
    expect(screen.queryByRole('button', { name: '作成して編集へ →' })).toBeNull()
    // 取得の失敗は ★V7 TargetMissing の error で出す（生の応答文は出さない）。
    expect(screen.getByText('シナリオを読み込めませんでした')).toBeTruthy()
    await click('もう一度読み込む')
    expect(m.get).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: '作成して編集へ →' })).toBeTruthy()
  })

  it('id 切替後に古い応答が上書きしない（SCENARIO-11の1通目側）', async () => {
    const slow = defer<unknown>()
    m.get.mockImplementation((id: string) =>
      id === 'sc-a'
        ? slow.promise
        : Promise.resolve(
            ok(
              scenario({
                id: 'sc-b',
                name: 'Bシナリオ',
                steps: [step({ id: 'b-step', messageContent: 'B本文' })],
              }),
            ),
          ),
    )
    let rerender!: (el: React.ReactNode) => void
    await act(async () => {
      ;({ rerender } = render(<FirstStep />))
    })
    m.params = new URLSearchParams('id=sc-b')
    await act(async () => rerender(<FirstStep />))
    expect(
      (screen.getByPlaceholderText('はじめまして。友だち追加ありがとうございます。') as HTMLTextAreaElement).value,
    ).toBe('B本文')
    await act(async () =>
      slow.resolve(ok(scenario({ steps: [step({ id: 'a-step', messageContent: 'A本文' })] }))),
    )
    expect(
      (screen.getByPlaceholderText('はじめまして。友だち追加ありがとうございます。') as HTMLTextAreaElement).value,
    ).toBe('B本文')
    await click('作成して編集へ →')
    expect(m.updateStep.mock.calls[0].slice(0, 2)).toEqual(['sc-b', 'b-step'])
  })
})

describe('SCENARIO-05：保存失敗で「保存中」のままにしない', () => {
  it('保存APIの例外でも busy を戻し、入力を残して再試行できる', async () => {
    m.updateStep.mockRejectedValueOnce(new Error('offline'))
    await mount(<FirstStep />)
    const body = screen.getByPlaceholderText(
      'はじめまして。友だち追加ありがとうございます。',
    ) as HTMLTextAreaElement
    fireEvent.change(body, { target: { value: '書きかけの本文' } })
    await click('作成して編集へ →')
    expect(screen.getByText(/保存できませんでした/)).toBeTruthy()
    const again = screen.getByRole('button', { name: '作成して編集へ →' }) as HTMLButtonElement
    expect(again.disabled).toBe(false)
    expect(body.value).toBe('書きかけの本文')
    await click('作成して編集へ →')
    expect(m.updateStep).toHaveBeenCalledTimes(2)
  })

  it('業務失敗（success:false）でも busy を戻して理由を出す', async () => {
    m.updateStep.mockResolvedValueOnce(fail)
    await mount(<FirstStep />)
    await click('作成して編集へ →')
    expect(screen.getByText('検証用エラー')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: '作成して編集へ →' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })
})
