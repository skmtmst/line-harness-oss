// @vitest-environment happy-dom
/*
 * N-209 R1: 成果承認の操作権限を新規スタッフへ付与する。
 *
 * 実物の画面をマウントして操作する。ソース文字列の検査では次が固定できない。
 *   - 「成果を承認・却下する」を選ぶと、保存する顔ぶれに表示権限も組で入ること
 *   - 表示権限を外すと操作権限も外れ、不整合な組み合わせが保存されないこと
 *   - 操作権限だけの不整合が保存直前に直ること
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  created: [] as unknown[],
  selectedAccountId: 'acc-1' as string | null,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.selectedAccountId, selectedAccount: { id: 'acc-1', name: '本店' } }),
}))
vi.mock('@/lib/api', () => ({
  api: {
    lineAccounts: { list: async () => ({ success: true, data: [{ id: 'acc-1', name: '本店' }] }) },
    staff: {
      create: async (data: unknown) => {
        fixture.created.push(data)
        return { success: true, data: { id: 'new-1' } }
      },
    },
  },
}))

const { default: NewStaffPage } = await import('./page')
const labels = await import('../permission-labels')

async function fillBasics() {
  render(<NewStaffPage />)
  await waitFor(() => {
    expect(screen.getByLabelText('最初に表示するアカウント')).toBeTruthy()
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /スタッフ/ }))
    fireEvent.change(screen.getByLabelText(/名前/), { target: { value: '承認担当' } })
    fireEvent.change(screen.getByLabelText(/メールアドレス/), { target: { value: 'approve@example.test' } })
    fireEvent.click(screen.getByLabelText('最初に表示するアカウント'))
    fireEvent.click(await screen.findByRole('button', { name: '本店' }))
  })
}

function opCheckbox() {
  return screen.getByRole('checkbox', { name: '成果を承認・却下する' })
}

function viewCheckbox() {
  return screen.getByRole('checkbox', { name: '成果とアフィリエイト' })
}

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '招待メールを送る' }))
  })
  await waitFor(() => {
    expect(fixture.created).toHaveLength(1)
  })
  return fixture.created[0] as { permissionKeys: string[] }
}

beforeEach(() => {
  fixture.created = []
})

afterEach(() => {
  cleanup()
})

describe('新規スタッフの成果承認権限', () => {
  test('操作権限を選ぶと表示権限も組で保存される', async () => {
    await fillBasics()
    await act(async () => {
      fireEvent.click(opCheckbox())
    })
    expect((opCheckbox() as HTMLInputElement).checked).toBe(true)
    expect((viewCheckbox() as HTMLInputElement).checked).toBe(true)
    const payload = await save()
    expect(payload.permissionKeys).toEqual(
      expect.arrayContaining(['/conversions', 'conversion.approval.edit']),
    )
  })

  test('表示権限を外すと操作権限も外れ、不整合が残らない', async () => {
    await fillBasics()
    await act(async () => {
      fireEvent.click(opCheckbox())
    })
    expect((viewCheckbox() as HTMLInputElement).checked).toBe(true)
    await act(async () => {
      fireEvent.click(viewCheckbox())
    })
    expect((viewCheckbox() as HTMLInputElement).checked).toBe(false)
    expect((opCheckbox() as HTMLInputElement).checked).toBe(false)
    // 別の表示機能を1件選んで保存できる形にする。
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: '受信箱' }))
    })
    const payload = await save()
    expect(payload.permissionKeys).not.toContain('conversion.approval.edit')
    expect(payload.permissionKeys).not.toContain('/conversions')
  })

  test('操作だけの不整合は保存直前に表示権限を足して直る', () => {
    expect(labels.normalizeStaffPermissionKeys(['conversion.approval.edit'])).toEqual(
      ['conversion.approval.edit', '/conversions'],
    )
    expect(labels.normalizeStaffPermissionKeys(['/conversions'])).toEqual(['/conversions'])
    expect(labels.toggleStaffPermissionKey(['/conversions', 'conversion.approval.edit'], '/conversions')).toEqual([])
  })
})
