// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConversionDetailDialog, type ConversionDetailDialogProps } from './dialogs'
afterEach(cleanup)
const props = (state: string, allowed: boolean): ConversionDetailDialogProps => ({
  detailTarget: { id: 'p', name: '購入', state, status: 'active', sourceType: 'manual', measureMethod: 'manual', valueMode: 'none', value: null, reversalPolicy: 'manual', sourceConfig: {}, usageCount: 0, ingest: { configured: false }, metrics: { netCount: 2 }, deduplicationMode: 'every' } as ConversionDetailDialogProps['detailTarget'],
  setDetailTarget: vi.fn(), publishing: false, publishDraft: vi.fn(), openEdit: vi.fn(), openStop: vi.fn(), issueIngest: vi.fn(), toggleIngest: vi.fn(), ingestBusy: '', ingestError: '', issuedSecret: '', ingestEvents: [], definitionEvents: [], eventsFailed: false, canReverse: allowed, openReversal: vi.fn(),
})
it.each(['draft', 'active'])('WEB-136: 閲覧のみの%s詳細から編集・停止・公開を隠す', (state) => {
  render(<ConversionDetailDialog {...props(state, false)} />)
  expect(screen.getByText('最近の成果')).toBeTruthy()
  for (const name of ['編集', '停止・削除する', '計測をはじめる（公開）']) expect(screen.queryByRole('button', { name })).toBeNull()
})
it('WEB-136: 管理者には変更操作を残す', () => {
  render(<ConversionDetailDialog {...props('draft', true)} />)
  for (const name of ['編集', '停止・削除する', '計測をはじめる（公開）']) expect(screen.getByRole('button', { name })).toBeTruthy()
})
it.each([false, true])('WEB-136: 外部からの受け口も管理権限%sに合わせ、設定は読める', (allowed) => {
  const value = props('active', allowed)
  value.detailTarget = { ...value.detailTarget!, measureMethod: 'webhook', ingest: { configured: true, disabledAt: null } }
  render(<ConversionDetailDialog {...value} />)
  expect(screen.getByText('受け口は動いています。鍵は発行済みです。')).toBeTruthy()
  for (const name of ['鍵を出し直す', '受け口を止める']) {
    expect(screen.queryByRole('button', { name }) !== null).toBe(allowed)
  }
})
