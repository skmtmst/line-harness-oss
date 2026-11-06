// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EmptyList from '@/components/shared/empty-list'
import { expectPermissionLocked } from '@/test-utils/permission-locked-control'

const create = vi.fn()
afterEach(() => { cleanup(); create.mockClear() })

describe('V8：閲覧のみの操作は灰色と理由で伝える', () => {
  it('権限が無い作成操作を残し、焦点・クリック・Enterで書き込みを起こさない', async () => {
    render(React.createElement(EmptyList, { icon: null, title: 'まだ登録がありません', description: '登録を確認できます', canCreate: false, create: { label: '最初の登録を作る', onClick: create } }))
    await expectPermissionLocked(screen.getByRole('button', { name: '最初の登録を作る' }))
    expect(create).not.toHaveBeenCalled()
  })

  it('作成権限がある操作は通常表示で実行できる', () => {
    render(React.createElement(EmptyList, { icon: null, title: 'まだ登録がありません', description: '登録を確認できます', canCreate: true, create: { label: '最初の登録を作る', onClick: create } }))
    const button = screen.getByRole('button', { name: '最初の登録を作る' })
    expect(button.getAttribute('aria-disabled')).not.toBe('true')
    expect(button.hasAttribute('data-permission-locked')).toBe(false)
    fireEvent.click(button)
    expect(create).toHaveBeenCalledOnce()
  })
})
