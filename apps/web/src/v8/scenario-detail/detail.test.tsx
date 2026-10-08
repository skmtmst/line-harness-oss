// @vitest-environment happy-dom
/*
 * V8 シナリオ配信の編集（src/v8/scenario-detail）の動きの試験。BEHAVIOR.md の「今までと変えたところ」を守る。
 * - V8 のテーマで、絵（PMLkX）の操作がそろって出る
 * - 閲覧のみ：帯が出て、変える操作のボタンは置かない（押せないボタンを残さない）
 * - 保存が 409（ほかの人が先に保存）なら競合の帯（kz2B6）と「比べてから保存」
 * - 下の帯の「複製する」で複製の窓（Al4Ek）が「〇〇 のコピー」で開く
 * - 選んだ通の中身がスマホに出る（空の箱にしない）
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
const updateScenario = vi.hoisted(() => vi.fn())
const triggerList = vi.hoisted(() => vi.fn(async () => ({ success: true, data: [{ id: 't1', kind: 'friend_add', tagId: null }] })))
const getScenario = vi.hoisted(() => vi.fn())

const scenario = vi.hoisted(() => ({
  id: 'sc-1',
  name: '新規登録7日間フォロー',
  description: '',
  triggerType: 'friend_add',
  isActive: true,
  allowConcurrent: true,
  folderId: null,
  deliveryMode: 'absolute_time',
  onCompleteMode: 'pause',
  lineAccountId: 'account-a',
  audienceCondition: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-10-01T05:02:00.000Z',
  steps: [
    {
      id: 'step-1', stepOrder: 1, delayMinutes: 0, offsetDays: 0, offsetMinutes: null, deliveryTime: '10:00',
      templateId: null, onReachTagId: null, afterSend: 'continue', messageType: 'text',
      messageContent: 'ご登録ありがとうございます。', targetCondition: null, question: null, isDraft: false,
    },
    {
      id: 'step-2', stepOrder: 2, delayMinutes: 0, offsetDays: 1, offsetMinutes: null, deliveryTime: '20:00',
      templateId: null, onReachTagId: null, afterSend: 'pause', messageType: 'text',
      messageContent: '使い方のポイント', targetCondition: null, question: null, isDraft: false,
    },
  ],
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message?: string) {
      super(message)
      this.status = status
    }
  },
  api: {
    scenarios: {
      get: getScenario,
      update: updateScenario,
      simulate: vi.fn(async () => ({ success: true, data: { audience: { newStartPlanned: 116 }, steps: [] } })),
      runs: vi.fn(async () => ({
        success: true,
        data: { steps: [], subscriptions: [], testSends: [], quota: { remaining: null, state: 'unlimited' } },
      })),
      triggers: { list: triggerList },
      actions: { list: vi.fn(async () => ({ success: true, data: [] })) },
      preview: vi.fn(async () => ({ success: true, data: { steps: [] } })),
    },
    folders: { list: vi.fn(async () => ({ success: true, data: [] })) },
    staff: { me: vi.fn(async () => ({ success: true, data: { role: 'owner' } })) },
  },
}))

vi.mock('@/components/scenarios/scenario-reference-data', () => ({
  scenarioReferenceData: {
    scenario: vi.fn(async () => ({ success: true, data: scenario })),
    stats: vi.fn(async () => ({
      success: true,
      data: { enrolledTotal: 428, activeNow: 116, completed: 312, paused: 0, steps: [] },
    })),
    templates: vi.fn(async () => ({ success: true, data: [] })),
    tags: vi.fn(async () => ({ success: true, data: [] })),
    invalidateScenario: vi.fn(),
  },
}))

vi.mock('@/components/scenarios/trigger-editor', () => ({
  default: ({ onChanged, onClose }: { onChanged?: (count: number) => void; onClose: () => void }) => (
    <div role="dialog" aria-label="開始のきっかけ（試験）">
      <button type="button" onClick={() => { onChanged?.(1); onClose() }}>きっかけを保存（試験）</button>
    </div>
  ),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/scenarios/detail',
  useSearchParams: () => new URLSearchParams('id=sc-1'),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: 'account-a',
    selectedAccount: { id: 'account-a', name: '本店' },
    accounts: [{ id: 'account-a', name: '本店' }],
    loading: false,
  }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => role.value }
})

import ScenarioDetailV8 from './detail'
import { ApiError } from '@/lib/api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

async function render() {
  act(() => {
    root.render(<ScenarioDetailV8 scenarioId="sc-1" showStarted={false} />)
  })
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
  await screen.findByRole('heading', { level: 1, name: '新規登録7日間フォロー' })
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  role.value = 'owner'
  updateScenario.mockReset()
  updateScenario.mockResolvedValue({ success: true, data: { id: 'sc-1' } })
  getScenario.mockReset()
  getScenario.mockResolvedValue({ success: true, data: { ...scenario, updatedAt: '2026-10-01T05:10:00.000Z' } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete document.documentElement.dataset.theme
  vi.clearAllMocks()
})

describe('V8 シナリオ配信の編集', () => {
  it('絵（PMLkX）の操作と3つの箱・数の帯が出る', async () => {
    await render()
    for (const name of ['配信結果を見る', 'まとめて下見', 'まとめてテストを送る', '設定を変える', '一時停止する', 'このシナリオを削除する', 'キャンセル', '複製する', '保存する']) {
      expect(screen.getAllByRole(name === '配信結果を見る' ? 'link' : 'button', { name }).length, name).toBeGreaterThan(0)
    }
    expect(screen.getByText('保存済み 10月1日 14:02')).toBeTruthy()
    expect(screen.getByText('友だち追加のとき')).toBeTruthy()
    expect(screen.getByText('送っています')).toBeTruthy()
    expect(screen.getByText('何もしない（一時停止）')).toBeTruthy()
    expect(screen.getByText('購読開始から0日後 10:00')).toBeTruthy()
    expect(screen.getByText('1日後 20:00')).toBeTruthy()
    // 選んだ通（先頭）の中身が右のスマホに出る（「配る内容がまだありません」の空の箱にしない）。
    expect(screen.getByText('選んだ通（1通目）の見え方')).toBeTruthy()
    expect(screen.queryByText('配る内容がまだありません')).toBeNull()
    expect(screen.getAllByText('ご登録ありがとうございます。').length).toBeGreaterThan(1)
  })

  it('閲覧のみ：帯が出て、変える操作のボタンを置かない（押せないボタンも残さない）', async () => {
    role.value = 'staff'
    await render()
    expect(screen.getByText('閲覧のみで見ています。変える操作は管理者に頼んでください。')).toBeTruthy()
    for (const name of ['まとめてテストを送る', '設定を変える', '一時停止する', '変える', 'このシナリオを削除する', '複製する', '保存する', 'メッセージを追加する', 'テンプレートを追加する', '＋ ここに挿入', '名前・説明・置き場を変える', 'このシナリオのその他操作', '1通目を上へ']) {
      expect(screen.queryByRole('button', { name }), name).toBeNull()
    }
    // 見る操作は残す。残ったボタンはどれも押せる。
    expect(screen.getByRole('button', { name: 'まとめて下見' })).toBeTruthy()
    const disabled = [...host.querySelectorAll('button')].filter((b) => b.disabled).map((b) => b.textContent || b.getAttribute('aria-label'))
    expect(disabled).toEqual([])
  })

  it('保存が 409 なら競合の帯（kz2B6）を出し、保存ボタンは「比べてから保存」になる', async () => {
    updateScenario.mockRejectedValueOnce(new (ApiError as unknown as new (s: number, m?: string) => Error)(409, 'conflict'))
    await render()
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('ほかの人が 14:10 にシナリオ「新規登録7日間フォロー」を保存しました')
    expect(within(alert).getByRole('button', { name: '最新を読み込んで続ける' })).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: '比べてから保存' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: '保存する' })).toBeNull()
  })

  it('下の帯の「複製する」で複製の窓（Al4Ek）が開き、名前は「〇〇 のコピー」', async () => {
    await render()
    fireEvent.click(screen.getByRole('button', { name: '複製する' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('このシナリオを複製する')
    expect(dialog.textContent).toContain('引き継ぐもの')
    expect((within(dialog).getByLabelText('新しい名前') as HTMLInputElement).value).toBe('新規登録7日間フォロー のコピー')
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

it('名前の保存中は×・閉じる・Escを止め、入力を残す', async () => {
  let finish!: (value: unknown) => void
  updateScenario.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await render()
  fireEvent.click(screen.getByRole('button', { name: '名前・説明・置き場を変える' }))
  const dialog = screen.getByRole('dialog', { name: '名前・説明・置き場を変える' })
  fireEvent.change(within(dialog).getByLabelText('シナリオ名'), { target: { value: '変更した名前' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'この内容で保存する' }))
  for (const button of within(dialog).getAllByRole('button', { name: '閉じる' })) {
    fireEvent.click(button)
  }
  fireEvent.keyDown(document, { key: 'Escape' })
  expect((within(dialog).getByLabelText('シナリオ名') as HTMLInputElement).value).toBe('変更した名前')
  expect(screen.getByRole('dialog', { name: '名前・説明・置き場を変える' })).toBeTruthy()
  await act(async () => { finish({ success: true, data: { id: 'sc-1' } }); await Promise.resolve() })
})

describe('監査 WEB227/228', () => {
  it('WEB227：到達の帯の幅は「50%」で、「50%%」にしない', async () => {
    const { scenarioReferenceData } = await import('@/components/scenarios/scenario-reference-data')
    vi.mocked(scenarioReferenceData.stats).mockResolvedValue({
      success: true,
      data: { enrolledTotal: 10, activeNow: 2, completed: 3, paused: 0, steps: [{ stepOrder: 1, reachedCount: 5, reachRate: 0.5 }] },
    } as never)
    await render()
    await waitFor(() => expect(host.querySelector('[class*="statBarFill"]')).toBeTruthy())
    const fill = host.querySelector<HTMLElement>('[class*="statBarFill"]')!
    expect(fill.style.width).toBe('50%')
  })

  it('WEB228：「内容と対象を確かめました」にチェックを入れるまで「この内容ではじめる」を押せない', async () => {
    const { scenarioReferenceData } = await import('@/components/scenarios/scenario-reference-data')
    vi.mocked(scenarioReferenceData.scenario).mockResolvedValue({ success: true, data: { ...scenario, isActive: false } } as never)
    await render()
    fireEvent.click(screen.getByRole('button', { name: /配信を再開する/ }))
    const start = await screen.findByRole('button', { name: 'この内容ではじめる' })
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(true))
    fireEvent.click(start)
    expect(updateScenario).not.toHaveBeenCalledWith('sc-1', { isActive: true })
  })
})

it('WEB229：開始のきっかけを保存したら、見出しのきっかけの名前を読み直す（同じ数でも）', async () => {
  await render()
  expect(host.textContent).toContain('友だち追加のとき')
  triggerList.mockResolvedValue({ success: true, data: [{ id: 't2', kind: 'form_answer', tagId: null }] })
  fireEvent.click(screen.getByRole('button', { name: /設定を変える/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'きっかけを保存（試験）' }))
  await waitFor(() => expect(host.textContent).toContain('フォームに答えたとき'))
})
