// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { folderDisplayColor } from '@/components/shared/folder-dot'
import FolderDistributionResult from './folder-distribution-result'
import DistributionResultDialog from './distribution-result-dialog'
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
  expect(pills).toHaveLength(1)
  const expected = document.createElement('span')
  expected.style.backgroundColor = folderDisplayColor(folder)
  for (const pill of pills) expect(pill.querySelector<HTMLElement>('[aria-hidden="true"]')!.style.backgroundColor).toBe(expected.style.backgroundColor)
})

it('画像削除で止めた店と成功した店を分けて表示し、やり直しを選べる', () => {
  const retry = vi.fn()
  const counts = { created: 0, overwritten: 0, aliased: 0 }
  render(<DistributionResultDialog open title="配布結果" summary="1店に配布しました" busy={false} onClose={vi.fn()} onRetry={retry} rows={[
    { key:'a', name:'本店', store:{accountId:'a',status:'succeeded',counts:{...counts,created:1}} },
    { key:'b', name:'支店', store:{accountId:'b',status:'failed',reason:'画像が削除中のため止めました。画像を差し替えて、もう一度配布してください。',counts} },
  ]} />)
  expect(screen.getByText('本店')).toBeTruthy()
  expect(screen.getByText('支店')).toBeTruthy()
  expect(screen.getByText('画像が削除中のため止めました。画像を差し替えて、もう一度配布してください。')).toBeTruthy()
  expect(screen.getByText('成功')).toBeTruthy()
  expect(screen.getByText('失敗')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', {name:'失敗した 1 件をやり直す'}))
  expect(retry).toHaveBeenCalledOnce()
})
