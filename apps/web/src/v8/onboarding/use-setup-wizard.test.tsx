// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { StyleState } from './model'
import { useSetupWizard } from './use-setup-wizard'

const fixture = vi.hoisted(() => ({ search: '', replace: vi.fn(), changed: vi.fn() }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(fixture.search) }))
vi.mock('@/components/shared/list-navigation', () => ({ useListNavigationRouter: () => ({ replace: fixture.replace }) }))
vi.mock('./wizard', () => ({ default: ({ accountId, initialStep, onClose }: { accountId: string; initialStep: string | number; onClose: (changed: boolean) => void }) => <div role="dialog" aria-label="質問" data-account={accountId} data-step={initialStep}><button onClick={() => onClose(false)}>閉じる</button><button onClick={() => onClose(true)}>保存を知らせる</button></div> }))

const state: StyleState = { style: 'restaurant', styleSelected: true, version: 1, answers: {} }
function Host({ account = 'a', role = 'owner', data = state }: { account?: string | null; role?: string | null; data?: StyleState | null }) {
  const wizard = useSetupWizard(account, data, role, fixture.changed)
  return <><button onClick={() => wizard.openStep('summary')}>中身</button><button onClick={() => wizard.openStep('unknown')}>未知の段</button>{wizard.dialog}</>
}
beforeEach(() => { fixture.search = ''; vi.clearAllMocks() })
afterEach(cleanup)

it.each(['0', 'summary'])('URLの段%sを現在の店で開き、閉じても他の表示指定を残す', async step => {
  fixture.search = `setup=${step}&range=week&view=calendar`
  render(<Host />)
  expect((await screen.findByRole('dialog')).getAttribute('data-step')).toBe(step)
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(fixture.replace).toHaveBeenCalledWith('/?range=week&view=calendar')
  expect(fixture.changed).not.toHaveBeenCalled()
})

it.each(['viewer', 'staff', null])('役割%sではURLでも操作でも質問を開かない', async role => {
  fixture.search = 'setup=0'
  const view = render(<Host />)
  await screen.findByRole('dialog')
  view.rerender(<Host role={role} />)
  fireEvent.click(screen.getByRole('button', { name: '中身' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('設定を取れない時や、他店へ切り替えた直後は前の質問を表示しない', async () => {
  fixture.search = 'setup=summary'
  const view = render(<Host />)
  expect((await screen.findByRole('dialog')).getAttribute('data-account')).toBe('a')
  view.rerender(<Host account="b" data={null} />)
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '中身' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  view.rerender(<Host account="b" />)
  expect((await screen.findByRole('dialog')).getAttribute('data-account')).toBe('b')
})

it('既知の段だけを開き、保存した時だけ設定を読み直す', async () => {
  render(<Host />)
  fireEvent.click(screen.getByRole('button', { name: '未知の段' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '中身' }))
  expect((await screen.findByRole('dialog')).getAttribute('data-step')).toBe('summary')
  fireEvent.click(screen.getByRole('button', { name: '保存を知らせる' }))
  expect(fixture.changed).toHaveBeenCalledTimes(1)
  expect(fixture.replace).not.toHaveBeenCalled()
})

it('新規の未選択だけを自動で案内し、閉じた質問やQRには割り込まない', async () => {
  const fresh = { ...state, styleSelected: false, shouldPromptStyleSelection: true }
  const view = render(<Host data={fresh} />)
  await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
  view.rerender(<Host data={{ ...fresh }} />)
  expect(screen.queryByRole('dialog')).toBeNull()
  fixture.search = 'qr=base'
  view.rerender(<Host account="b" data={fresh} />)
  expect(screen.queryByRole('dialog')).toBeNull()
})

it.each(['閉じる', '保存を知らせる'])('設定から開いた質問を「%s」で閉じると設定へ戻る', async name => {
  fixture.search = 'setup=0&setupReturn=accounts'
  render(<Host />)
  await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('button', { name }))
  expect(fixture.replace).toHaveBeenCalledWith('/accounts')
})

it('不明な戻り先を指定しても外のサイトに移らない', async () => {
  fixture.search = 'setup=0&setupReturn=https%3A%2F%2Fevil.example&range=week'
  render(<Host />)
  await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
  expect(fixture.replace).toHaveBeenCalledWith('/?range=week')
})
