// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import OperationTargetSummary from './operation-target-summary'
const net = vi.hoisted(() => ({ version: vi.fn(), accounts: vi.fn() }))
vi.mock('@/lib/admin-version-cache', () => ({ loadAdminVersionDetail: net.version }))
vi.mock('@/lib/line-accounts-cache', () => ({ loadLineAccounts: net.accounts }))
beforeEach(() => {
  net.version.mockReset().mockResolvedValue({ version: '2.7.0', deploy_env: 'staging' })
  net.accounts.mockReset().mockResolvedValue({ success: true, data: [{ id: 'b', name: '別のアカウント' }, { id: 'a', name: '対象のアカウント' }] })
})
afterEach(cleanup)
it('操作先のIDに一致する名前だけを出し、店とアカウントの切替後は前の対象を残さない', async () => {
  const view = render(<OperationTargetSummary accounts={[{ id: 'a' }]} store={{ id: 's-a', name: '対象の店' }} />)
  const region = within(screen.getByRole('region', { name: '操作の対象' }))
  await region.findByText('対象のアカウント')
  expect(region.queryByText('別のアカウント')).toBeNull()
  expect(region.getByText('対象の店')).toBeTruthy()
  expect(region.getByText('検証環境')).toBeTruthy()
  expect(region.getByText('対象のアカウント').title).toContain('a')
  view.rerender(<OperationTargetSummary accounts={[{ id: 'b' }]} store={{ id: 's-b', name: '切替先の店' }} />)
  await region.findByText('別のアカウント')
  expect(region.queryByText('対象のアカウント')).toBeNull()
  expect(region.queryByText('対象の店')).toBeNull()
  expect(region.getByText('切替先の店')).toBeTruthy()
})
it('環境の取得中と失敗を区別し、URLや名前から本番か検証かを決めない', async () => {
  let reject!: (e: Error) => void
  net.version.mockReturnValue(new Promise((_resolve, fail) => { reject = fail }))
  render(<OperationTargetSummary accounts={[{ id: 'a', name: '本番の店' }]} />)
  expect(screen.getByText('確認中')).toBeTruthy()
  reject(new Error('offline'))
  await screen.findByText('確認できません')
  expect(screen.queryByText('検証環境')).toBeNull()
  expect(screen.queryByText('本番環境')).toBeNull()
})
it.each([['production', '本番環境'], ['staging', '検証環境'], [null, '確認できません'], ['preview-custom', 'preview-custom']] as const)('配備環境%sを事実どおり示す', async (deploy_env, label) => {
  net.version.mockResolvedValue({ version: '2.7.0', deploy_env })
  render(<OperationTargetSummary accounts={[{ id: 'a', name: 'LINEの名前' }]} />)
  await screen.findByText(label)
  expect(net.accounts).not.toHaveBeenCalled()
})
it('アカウント一覧を読めない時は先頭や他の店の名前で補わない', async () => {
  net.accounts.mockRejectedValue(new Error('offline'))
  render(<OperationTargetSummary accounts={[{ id: 'missing' }]} />)
  await screen.findByText('検証環境')
  expect(screen.getByText('名前を確認できません').title).toBe('missing')
  expect(screen.queryByText('店舗')).toBeNull()
})
