// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { folderDisplayColor } from '@/components/shared/folder-dot'
import FolderDistributionResult from './folder-distribution-result'
import type { FolderRun } from './folder-distribution'

afterEach(cleanup)

it.each([null, '#123456'])('フォルダをまとめて配った結果と結果の窓はタグのフォルダ色 %s を保つ', (color) => {
  const folder = { id: 'f-test', name: 'テスト', color, revision: 1 }
  const run: FolderRun = {
    template: { id: 't-1', name: '定期', description: null, template_type: 'tag', folder_id: folder.id, revision: 1, updated_at: '2026-10-09' },
    accountIds: ['a-1'], runId: 'run-1',
    result: { runId: 'run-1', status: 'completed', stores: [{ accountId: 'a-1', accountName: '本店', status: 'succeeded', counts: { created: 1, overwritten: 0, aliased: 0 } }] },
  }
  render(<FolderDistributionResult name={folder.name} runs={[run]} accounts={[{ id: 'a-1', name: '本店' }]} folders={[folder]} busy={false} error=""
    onBack={vi.fn()} onRefresh={vi.fn()} onRetry={vi.fn()} onRecheck={vi.fn()} />)
  const pills = screen.getAllByRole('group', { name: 'タグ「定期」' })
  expect(pills).toHaveLength(2)
  const expected = document.createElement('span')
  expected.style.backgroundColor = folderDisplayColor(folder)
  for (const pill of pills) expect(pill.querySelector<HTMLElement>('[aria-hidden="true"]')!.style.backgroundColor).toBe(expected.style.backgroundColor)
})
