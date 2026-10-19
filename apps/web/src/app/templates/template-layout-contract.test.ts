import { readUiSource } from '../../../scripts/test-ui-source.mjs'
// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import TemplateDeleteDialog from '@/v8/templates/delete-dialog'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(HERE, path), 'utf8')

afterEach(cleanup)

describe('テンプレート一覧のV8削除動作', () => {
  const page = readUiSource(join(HERE, '../../v8/templates/list.tsx'), 'utf8') + read('../../v8/templates/words.ts')
  const detail = read('../../v8/template-detail/detail.tsx')

  it('参照中は強制削除せず、使用先を確認させる', () => {
    expect(page).toContain('使っている所を見る')
    expect(page).toContain('先に別のテンプレートへ差し替えてください。')
    expect(page).not.toContain('削除すると参照がクリアされます')
    for (const usage of ['scenarioSteps', 'reminderSteps', 'richMenuAreas', 'trackedLinks']) {
      expect(page).toContain(usage)
    }
    expect(detail).toContain('if (deleting || usageCount > 0 || !template) return')
    expect(detail).toContain('setBlockedOpen(true)')
    expect(detail).not.toContain('削除すると、その箇所の本文が空になります')
  })

  it('V8の削除確認を共通ダイアログで表示し、ブラウザ標準確認へ戻さない', () => {
    const remove = vi.fn(), cancel = vi.fn()
    const nativeConfirm = vi.spyOn(window, 'confirm')
    render(React.createElement(TemplateDeleteDialog, { open: true,
      title: '「案内の文」を削除しますか？', onConfirm: remove, onCancel: cancel }))
    expect(screen.getByRole('alertdialog').textContent).toContain('案内の文')
    expect(screen.getByRole('alert').textContent).toContain('削除は元に戻せません')
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(cancel).toHaveBeenCalledOnce()
    expect(remove).not.toHaveBeenCalled()
    expect(nativeConfirm).not.toHaveBeenCalled()
    // 一覧と詳細の削除条件も保持し、使用中の物はこの窓へ通さない。
    expect(page).toContain('open={pendingDelete !== null}')
    expect(detail).toContain('open={deleteOpen && usageCount === 0}')
    expect(page + detail).not.toContain("confirm('このテンプレートを削除しますか？')")
    nativeConfirm.mockRestore()
  })
})
