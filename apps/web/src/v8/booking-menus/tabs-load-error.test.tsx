// @vitest-environment happy-dom
/*
 * 監査 WEB053：受付枠・予約のルールのタブは、初めの読み込みに失敗したら
 * 「読み込み中」のまま残さず、読み直しを出す。
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
}))

import { RulesTabV8 } from './tabs/rules-tab'
import { HoursTabV8 } from './tabs/hours-tab'

afterEach(cleanup)

describe('予約設定のタブの読み込み失敗（WEB053）', () => {
  it('予約のルール：失敗したら読み直しを出す', () => {
    render(<RulesTabV8 accountId="a" settings={null} status="error" error="通信が切れました" staff={[]} staffReady canEdit onSaved={() => undefined} onReload={() => undefined} />)
    expect(screen.getByText('予約のルールを読み込めませんでした')).toBeTruthy()
    expect(screen.getByRole('button', { name: '読み直す' })).toBeTruthy()
  })

  it('受付枠：失敗したら読み直しを出す', () => {
    render(<HoursTabV8 accountId="a" settings={null} settingsStatus="error" settingsError="通信が切れました" resources={null} resourcesStatus="error" resourcesError={null} canEdit menus={[]} onSaved={() => undefined} onReload={() => undefined} onResourceSaved={() => undefined} onResourceCreated={() => undefined} onResourceDeleted={() => undefined} onResourcesRetry={() => undefined} />)
    expect(screen.getByText('受付枠を読み込めませんでした')).toBeTruthy()
  })
})
