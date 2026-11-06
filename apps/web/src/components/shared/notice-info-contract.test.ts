// @vitest-environment happy-dom
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import React from 'react'
import { render, cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import Notice from './notice'
import ReadOnlyNotice, { READ_ONLY_MESSAGE } from './read-only-notice'

afterEach(cleanup)

describe('共通の案内と閲覧のみの知らせ', () => {
  it('題・説明・保存状態を同じ知らせで読み上げる', () => {
    render(React.createElement(Notice, { tone: 'info', heading: '保存の結果', message: '続きから保存できます。',
      states: [{ state: 'done', label: '基本情報は保存済み' }, { state: 'pending', label: '追加情報は未保存' }] }))
    const notice = screen.getByRole('note')
    expect(notice.textContent).toContain('保存の結果')
    expect(notice.textContent).toContain('続きから保存できます。')
    expect(screen.getByRole('list', { name: '保存の状態' }).children).toHaveLength(2)
  })
  it('閲覧のみの文言とstatusの役割を保つ', () => {
    verifiedStaffRole('viewer')
    render(React.createElement(ReadOnlyNotice))
    expect(screen.getByRole('status').textContent).toBe(READ_ONLY_MESSAGE)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

afterEach(() => { verifiedStaffRole(null) })
