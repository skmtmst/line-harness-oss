// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ProjectFormDialog from './project-form-dialog'

/**
 * プロジェクトを作る V8（板 W7Z57）。
 * - 外枠に W7Z57 を付ける
 * - 名前が空のまま作らせない（作るボタンが押せない）
 * v7 の下の帯は変えない。
 */
const fixture = vi.hoisted(() => ({ theme: 'v8' as 'v7' | 'v8', submit: vi.fn() }))
vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => fixture.theme }))

beforeEach(() => { vi.clearAllMocks(); fixture.theme = 'v8' })
afterEach(cleanup)

function openCreate() {
  render(<ProjectFormDialog open project={null} onSubmit={fixture.submit} onCancel={() => undefined} />)
}

describe('プロジェクトを作る V8（W7Z57）', () => {
  it('名前が空のとき作って開くを押せない', () => {
    openCreate()
    expect(document.querySelector('[data-design-node="W7Z57"]')).toBeTruthy()
    const create = screen.getByRole('button', { name: '＋ 作って開く' }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('例: 春の感謝祭 2周年'), { target: { value: '秋の企画' } })
    expect(create.disabled).toBe(false)
    fireEvent.click(create)
    expect(fixture.submit).toHaveBeenCalledWith({ name: '秋の企画', description: '' })
  })

  it('v7 の下の帯は変えない', () => {
    fixture.theme = 'v7'
    openCreate()
    expect(screen.getByRole('button', { name: 'プロジェクトを作る' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '＋ 作って開く' })).toBeNull()
  })
})
