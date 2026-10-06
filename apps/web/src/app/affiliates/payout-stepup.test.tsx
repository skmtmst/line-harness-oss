// @vitest-environment happy-dom
/*
 * 銀行用CSVの本人確認窓（★V8-B `CVz5d`）。
 * 6桁コードを入れる前に、書き出す中身（件数・合計）を見せます。
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'

vi.mock('@/lib/api', () => ({
  api: {
    affiliates: {
      payoutStepUp: async () => ({ success: true, data: { token: 'tok', purpose: 'affiliate.payout.export', expiresAt: 'x' } }),
      exportPayoutBatch: async () => ({ success: true, data: { downloadUrl: '/dl/x.csv' } }),
    },
  },
}))
vi.mock('@/lib/session-snapshot', () => ({
  readSessionSnapshot: () => ({ stepUpMethod: 'totp' }),
}))

const { PayoutStepUpDialog } = await import('./payment-tab')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const BATCH = {
  id: 'batch-1',
  lineAccountId: 'acc-1',
  settlementId: 'set-1',
  totalAmount: 70400,
  currency: 'JPY',
  lineCount: 38,
  state: 'ready',
  bankFormat: null,
  fileChecksum: null,
  version: 1,
  downloadExpiresAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
}

afterEach(cleanup)

describe('銀行用CSVの本人確認 V8', () => {
  it('CVz5d の印で書き出す中身（件数・合計）を出す', async () => {
    render(
      <PayoutStepUpDialog batch={BATCH} accountId="acc-1" onClose={() => {}} onExported={() => {}} />,
    )
    /* 窓は別所（ポータル）に描かれるため、文書全体から探す。 */
    expect(document.querySelector('[data-design-node="CVz5d"]')).toBeTruthy()
    expect(await screen.findByText('書き出す中身：38件・¥70,400')).toBeTruthy()
  })
})
