// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ScenarioDraftStatus, scenarioDraftStatus } from './browser-draft-notice'
import { SCENARIO_DRAFT_WORDS } from './use-scenario-draft'
import { AUTOSAVE_DELAY_MS } from './use-draft-autosave'
import StickyBar from '@/components/shared/sticky-bar'

afterEach(cleanup)

it('失敗は短い1行で伝え、詳細に入力を残すことと再試行・保存の違いを置く', async () => {
  render(<ScenarioDraftStatus label={SCENARIO_DRAFT_WORDS.failed} />)
  expect(screen.getByText('自動保存できませんでした', { exact: true })).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
  const detail = screen.getByRole('button', { name: '自動保存できなかった時の詳細' })
  expect(detail.textContent).toBe('詳細')
  fireEvent.click(detail)
  const dialog = await screen.findByRole('dialog', { name: '下書きを自動保存できませんでした' })
  expect(dialog.textContent).toContain('入力内容はこの画面に残っています')
  expect(dialog.textContent).toContain(`入力が止まって${AUTOSAVE_DELAY_MS / 1000}秒後`)
  expect(dialog.textContent).toContain('下書きだけを残す操作ではありません')
  expect(within(dialog.querySelector('[data-window-actions]')!).queryByRole('button')).toBeNull()
  const close = within(dialog).getByRole('button', { name: '閉じる', exact: true })
  fireEvent.click(close)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByText('自動保存できませんでした', { exact: true })).toBeTruthy()
})

it('正常と保存中は元の文字のままで、失敗を読み終えた後に次の失敗の窓を勝手に開かない', async () => {
  const view = render(<ScenarioDraftStatus label="下書き保存済み・1秒前" />)
  expect(screen.getByText('下書き保存済み・1秒前')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
  view.rerender(<ScenarioDraftStatus label={SCENARIO_DRAFT_WORDS.failed} />)
  fireEvent.click(screen.getByRole('button', { name: '自動保存できなかった時の詳細' }))
  await screen.findByRole('dialog')
  view.rerender(<ScenarioDraftStatus label="下書きを保存しています" />)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByText('下書きを保存しています')).toBeTruthy()
  view.rerender(<ScenarioDraftStatus label={SCENARIO_DRAFT_WORDS.failed} />)
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('通常の帯は文字列とtitleを保ち、状態が無ければ空の帯も出さない', () => {
  const view = render(<StickyBar actions={<button>保存</button>} status={scenarioDraftStatus('下書き保存済み・1秒前')} />)
  expect(screen.getByText('下書き保存済み・1秒前').getAttribute('title')).toBe('下書き保存済み・1秒前')
  view.rerender(<StickyBar actions={<button>保存</button>} status={scenarioDraftStatus(null)} />)
  expect(view.container.querySelector('[data-sticky-lead]')?.children.length).toBe(0)
})
