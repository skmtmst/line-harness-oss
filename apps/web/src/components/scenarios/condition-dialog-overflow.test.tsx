// @vitest-environment happy-dom
/*
 * 条件窓の外枠の証明: 長い詳細内容でも白い窓の境界内に収まる。
 * header/footer は窓の境界内にとどまり、中身だけが body 内部で
 * スクロールする（1080-gui-7cd-post1091 の footer 漏れの再発防止）。
 * 警告・2 pickers・保存阻止の動作は既存の empty-or 試験が守る。
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConditionDialog } from './scenario-dialogs'

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', accounts: [] }),
}))

vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({ status: 'ready' as const, features: {}, enabled: () => true }),
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    tags: { list: async () => ({ success: true as const, data: [] }) },
    friendFields: { list: async () => ({ success: true as const, data: [] }) },
    supportMarks: { list: async () => ({ success: true as const, data: [] }) },
    scenarios: { list: async () => ({ success: true as const, data: [] }) },
    segments: { count: async () => ({ success: true as const, data: { count: 0 } }) },
  },
}))

afterEach(() => cleanup())

function renderDialog() {
  render(
    <ConditionDialog
      title="この通の配信対象"
      description="条件に合わない人には、この通だけ送りません。"
      value={null}
      onSave={async () => {}}
      onClose={() => {}}
    />,
  )
  return screen.getByRole('dialog')
}

describe('条件窓は境界内に収まる', () => {
  it('窓の高さは viewport に収まる上限を持つ', () => {
    const panel = renderDialog()
    // 固定 912 のままだと低い画面で footer が白い窓の外へ漏れる。
    expect(panel.style.maxHeight).toContain('dvh')
  })

  it('中身は body 内部でスクロールし header/footer は縮まない', () => {
    const panel = renderDialog()
    const [header, body, footer] = Array.from(panel.children)
    expect(body.className).toContain('overflow-y-auto')
    expect(body.className).toContain('min-h-0')
    expect(header.className).toContain('shrink-0')
    expect(footer.className).toContain('shrink-0')
  })

  it('footer のキャンセルと反映は窓の中にある', () => {
    renderDialog()
    const panel = screen.getByRole('dialog')
    expect(panel.contains(screen.getByRole('button', { name: 'キャンセル' }))).toBe(true)
    expect(panel.contains(screen.getByRole('button', { name: 'この条件を反映' }))).toBe(true)
  })
})
