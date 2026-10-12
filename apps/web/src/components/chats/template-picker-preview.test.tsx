// @vitest-environment happy-dom
/*
 * N-026: テンプレート選択のプレビューは送信と同じ解決器の結果を見せる。
 *
 * 実物の TemplatePicker をマウントして確かめる。
 *   - 差し込みを含むテンプレートでは render-preview の解決済み本文が出る
 *   - 解決しきれない差し込み名は警告として出る
 *   - 差し込みを含まないテンプレートでは render-preview を呼ばない
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  renderPreviewCalls: [] as unknown[],
  renderPreviewResult: {
    success: true,
    data: { content: '利用者1さん、ポチの件です {{pet_name}}', unresolved: ['pet_name'] },
  } as { success: boolean; data?: { content: string; unresolved: string[] } },
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1' }),
}))

vi.mock('@/lib/api', () => ({
  api: {
    templates: {
      // PERF-12: 選択画面は区画取得(listPage)を使う。
      listPage: async () => {
        const items = [
          { id: 'tp-var', accountId: 'acc-1', name: '差し込みあり', messageType: 'text', messageContent: '{{name}}さん、{{field.pet_name}}の件です {{pet_name}}', folderId: null },
          { id: 'tp-plain', accountId: 'acc-1', name: '差し込みなし', messageType: 'text', messageContent: 'そのままの挨拶です', folderId: null },
        ]
        return {
          success: true,
          data: { items, total: items.length, limit: 100 },
        }
      },
    },
    folders: {
      list: async () => ({ success: true, data: [] }),
    },
    chats: {
      renderPreview: (...args: unknown[]) => {
        fixture.renderPreviewCalls.push(args)
        return Promise.resolve(fixture.renderPreviewResult)
      },
    },
  },
}))

const { default: TemplatePicker } = await import('./template-picker')

afterEach(() => {
  cleanup()
  fixture.renderPreviewCalls = []
})

describe('テンプレート選択のプレビュー解決(N-026)', () => {
  test('差し込みを含むテンプレートは解決済み本文を見せ、未解決名を警告する', async () => {
    await act(async () => {
      render(<TemplatePicker open onClose={() => {}} onPick={() => {}} chatId="fr-1" />)
    })
    // 一覧の先頭(差し込みあり)が選択済みになり、render-preview が呼ばれる。
    await waitFor(() => {
      expect(fixture.renderPreviewCalls.length).toBeGreaterThan(0)
    })
    const call = fixture.renderPreviewCalls[0] as [string, { content: string }]
    expect(call[0]).toBe('fr-1')
    expect(call[1].content).toContain('{{name}}')
    await waitFor(() => {
      expect(screen.getByText((_, element) => element?.tagName === 'SPAN' && element.textContent === '利用者1さん、ポチの件です {{pet_name}}')).toBeTruthy()
    })
    expect(document.querySelector('[data-token="{{name}}"]')?.textContent).toBe('利用者1')
    expect(document.querySelector('[data-token="{{field.pet_name}}"]')?.textContent).toBe('ポチ')
    // 解決しきれない差し込みは警告として出る。
    expect(screen.getByRole('alert').textContent).toContain('{{pet_name}}')
  })

  test('差し込みを含まないテンプレートは render-preview を呼ばず生の本文を見せる', async () => {
    await act(async () => {
      render(<TemplatePicker open onClose={() => {}} onPick={() => {}} chatId="fr-1" />)
    })
    await waitFor(() => {
      expect(screen.getAllByText('差し込みなし').length).toBeGreaterThan(0)
    })
    // 差し込みなしのテンプレートを選ぶ。
    await act(async () => {
      screen.getAllByText('差し込みなし')[0].closest('button')!.click()
    })
    await waitFor(() => {
      expect(screen.getAllByText('そのままの挨拶です').length).toBeGreaterThan(0)
    })
    // 差し込みなし選択では render-preview は呼ばれない(初回選択の差し込みあり分のみ)。
    const calls = fixture.renderPreviewCalls as Array<[string, { content: string }]>
    expect(calls.every((c) => c[1].content.includes('{{'))).toBe(true)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('chatIdが無いときは render-preview を呼ばず生の本文を見せる', async () => {
    await act(async () => {
      render(<TemplatePicker open onClose={() => {}} onPick={() => {}} />)
    })
    await waitFor(() => {
      expect(screen.getAllByText('差し込みあり').length).toBeGreaterThan(0)
    })
    // プレビュー領域は生の本文のまま。
    await waitFor(() => {
      expect(screen.getAllByText('{{name}}さん、{{field.pet_name}}の件です {{pet_name}}').length).toBeGreaterThan(0)
    })
    expect(fixture.renderPreviewCalls).toHaveLength(0)
    expect(screen.queryByRole('alert')).toBeNull()
  })
  test('解決済み本文を表示しても入力欄へ渡す値は元の差し込み文字列', async () => {
    const onPick = vi.fn()
    render(<TemplatePicker open onClose={() => {}} onPick={onPick} chatId="fr-1" />)
    await waitFor(() => expect(document.querySelector('[data-token="{{name}}"]')?.textContent).toBe('利用者1'))
    fireEvent.click(screen.getByRole('button', { name: '入力欄に入れる' }))
    expect(onPick).toHaveBeenCalledWith('{{name}}さん、{{field.pet_name}}の件です {{pet_name}}')
  })

  test('別の会話へ切り替えたら前の相手の値を表示せず、遅れた応答も採用しない', async () => {
    const deferred: Array<{ id: string; resolve: (value: unknown) => void }> = []
    const preview = vi.spyOn((await import('@/lib/api')).api.chats, 'renderPreview').mockImplementation((id: string) => new Promise(resolve => deferred.push({ id, resolve })) as never)
    const view = render(<TemplatePicker open onClose={() => {}} onPick={() => {}} chatId="fr-old" />)
    await waitFor(() => expect(deferred.some(call => call.id === 'fr-old')).toBe(true))
    view.rerender(<TemplatePicker open onClose={() => {}} onPick={() => {}} chatId="fr-new" />)
    await waitFor(() => expect(deferred.some(call => call.id === 'fr-new')).toBe(true))
    await act(async () => deferred.find(call => call.id === 'fr-new')!.resolve({ success: true, data: { content: '新しい方さん、ポチの件です {{pet_name}}', unresolved: ['pet_name'] } }))
    await act(async () => deferred.filter(call => call.id === 'fr-old').forEach(call => call.resolve({ success: true, data: { content: '前の方さん、ポチの件です {{pet_name}}', unresolved: ['pet_name'] } })))
    expect(document.querySelector('[data-token="{{name}}"]')?.textContent).toBe('新しい方')
    expect(screen.queryByText('前の方')).toBeNull()
    preview.mockRestore()
  })

})
