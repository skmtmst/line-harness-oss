// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ListPageBody } from './list-page'
import ListToolbar, { ListToolbarEnd, ListToolbarFrame, ListToolbarRow } from '@/components/shared/list-toolbar'
import PageSizeSelect from '@/components/shared/page-size-select'

afterEach(cleanup)

const count = <PageSizeSelect value={20} onChange={() => {}} />
const explicit = <ListToolbarFrame><ListToolbarRow><button>種類：すべて</button><ListToolbarEnd>{count}</ListToolbarEnd></ListToolbarRow></ListToolbarFrame>

it.each([
  ['明示の行', explicit],
  ['標準の道具', <ListToolbar key="standard" filters={<button>種類：すべて</button>} trailing={count} />],
])('%sの末尾へ説明を渡し、件数の前で開ける', (_name, toolbar) => {
  const { container } = render(<ListPageBody toolbar={toolbar} listHelp="道具の使い方" listHelpPlacement="end">表</ListPageBody>)
  const help = screen.getByRole('button', { name: '一覧の操作の説明' })
  const end = help.closest('[data-toolbar-end]')!
  expect(end).toBeTruthy()
  const size = end.querySelector('[aria-haspopup="listbox"]')!
  expect(help.compareDocumentPosition(size) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(container.querySelectorAll('[aria-label="一覧の操作の説明"]')).toHaveLength(1)
  fireEvent.click(help)
  expect(screen.getByText('道具の使い方')).toBeTruthy()
})

it('既定と道具が無い場合は説明の配置を変えない', () => {
  const { rerender } = render(<ListPageBody toolbar={explicit} listHelp="道具の使い方">表</ListPageBody>)
  expect(screen.getByRole('button', { name: '一覧の操作の説明' }).closest('[data-toolbar-end]')).toBeNull()
  rerender(<ListPageBody listHelp="道具の使い方" listHelpPlacement="end">表</ListPageBody>)
  expect(screen.getByRole('button', { name: '一覧の操作の説明' }).closest('[data-template-region="toolbar"]')).toBeTruthy()
})
