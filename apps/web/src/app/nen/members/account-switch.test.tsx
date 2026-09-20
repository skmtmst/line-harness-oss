// @vitest-environment happy-dom
/*
 * DEEP-21: NEN会員のランク設定・ライフタイムで、アカウントAを編集したまま
 * Bへ切り替えたとき、Aの下書き（AのIDと編集内容）がBへ保存されないことを確かめる。
 * 監査の再現: audit-reports reproductions/audit-deep-rank-account.test.tsx
 *
 * 修正後の期待：切替の瞬間に下書きとdirtyは破棄され（破棄したことは画面へ出す）、
 * Bの設定だけが表示される。未保存ではないので保存はできず、AのIDはBへ送られない。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NenRankSettingsData } from '@/lib/nen-ranks-api'

const m = vi.hoisted(() => ({ ranks: vi.fn(), milestones: vi.fn(), resync: vi.fn() }))
vi.mock('@/lib/nen-ranks-api', () => ({ nenRanksApi: { saveRanks: m.ranks, saveMilestones: m.milestones, resync: m.resync } }))

import RankSettingsTab from './rank-settings-tab'
import LifetimeTab from './lifetime-tab'

const settings = (account: string): NenRankSettingsData => ({
  ranks: [{ id: `rank-${account}`, key: 'regular', name: `${account}ランク`, annualThresholdYen: 0, mileRatePercent: 1, tagId: null, tagName: null, memberCount: 0 }],
  milestones: [{ id: `milestone-${account}`, thresholdYen: 1000, title: `${account}称号`, benefitKind: null, benefitNote: null, notifyOnReach: false, reachedCount: 0 }],
  rules: null,
  kpis: { members: 0, annualTotalYen: 0, lifetimeTotalYen: 0, balanceTotal: 0, usedThisMonth: 0, byRank: {} },
})
const flush = () => act(async () => { await Promise.resolve() })
const common = () => ({ status: 'ready' as const, onSaved: vi.fn(), onRetry: vi.fn() })

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  m.ranks.mockResolvedValue({ success: false, error: 'mock-stop' })
  m.milestones.mockResolvedValue({ success: false, error: 'mock-stop' })
})

describe('DEEP-21 ランク設定タブ', () => {
  it('Aを編集したままBへ切り替えると下書きは破棄され、Bの設定が出る。Aの内容はBへ送れない', async () => {
    const props = common()
    const v = render(<RankSettingsTab {...props} accountId="A" settings={settings('A')} />)
    await flush()
    fireEvent.change(screen.getByLabelText('ランク名 1'), { target: { value: 'A編集中' } })

    v.rerender(<RankSettingsTab {...props} accountId="B" settings={settings('B')} />)
    await flush()

    // 表示はBのランク。Aの編集内容は残らず、破棄したことは画面へ出る
    expect((screen.getByLabelText('ランク名 1') as HTMLInputElement).value).toBe('Bランク')
    expect(screen.getByText(/保存していない変更は破棄しました/)).toBeTruthy()

    // 未保存ではないので保存は無効。AのIDをBへ送らない
    const saveButton = screen.getByRole('button', { name: /保存/ }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(true)
    fireEvent.click(saveButton)
    await flush()
    expect(m.ranks).not.toHaveBeenCalled()
  })

  it('同じアカウントでの編集と保存は従来どおり動く', async () => {
    const props = common()
    render(<RankSettingsTab {...props} accountId="A" settings={settings('A')} />)
    await flush()
    fireEvent.change(screen.getByLabelText('ランク名 1'), { target: { value: 'A編集中' } })
    fireEvent.click(screen.getByRole('button', { name: /保存/ }))
    await flush()
    expect(m.ranks).toHaveBeenCalledWith('A', expect.arrayContaining([expect.objectContaining({ id: 'rank-A', name: 'A編集中' })]))
  })

  it('保存応答には編集元のアカウントが付く（親は別アカウントへ切替済みなら捨てられる）', async () => {
    const props = common()
    m.ranks.mockResolvedValueOnce({ success: true, data: settings('A') })
    render(<RankSettingsTab {...props} accountId="A" settings={settings('A')} />)
    await flush()
    fireEvent.change(screen.getByLabelText('ランク名 1'), { target: { value: 'A編集中' } })
    fireEvent.click(screen.getByRole('button', { name: /保存/ }))
    await flush()
    expect(props.onSaved).toHaveBeenCalledWith('A', expect.anything())
  })
})

describe('DEEP-21 ライフタイムタブ', () => {
  it('Aを編集したままBへ切り替えると下書きは破棄され、Aの節目はBへ送れない', async () => {
    const props = common()
    const v = render(<LifetimeTab {...props} accountId="A" settings={settings('A')} />)
    await flush()
    fireEvent.change(screen.getByLabelText('称号 1'), { target: { value: 'A編集中' } })

    v.rerender(<LifetimeTab {...props} accountId="B" settings={settings('B')} />)
    await flush()

    expect((screen.getByLabelText('称号 1') as HTMLInputElement).value).toBe('B称号')
    expect(screen.getByText(/保存していない変更は破棄しました/)).toBeTruthy()

    const saveButton = screen.getByRole('button', { name: /保存/ }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(true)
    fireEvent.click(saveButton)
    await flush()
    expect(m.milestones).not.toHaveBeenCalled()
  })
})
