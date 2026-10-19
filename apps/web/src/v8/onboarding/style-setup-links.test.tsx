// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { featureHref, questionsFor, summarizeSetup } from './model'
import { setupLinksFor } from './setup-links'
import { useStarterMenu } from './use-starter-menu'
const net = vi.hoisted(() => ({ starterSet: vi.fn() }))
vi.mock('@/lib/api/helpers/styles', () => ({ styleApi: net }))
afterEach(cleanup)

it('実装済みの回数券・支払い・面談・振替・ECの設定先へ案内する', () => {
  for (const style of ['salon', 'lesson'] as const) {
    const tickets = questionsFor(style).find(q => q.key === 'tickets')!
    expect(tickets.manualHref).toBe('/booking/menus?tab=passes')
    expect(tickets.preparing).toBeUndefined()
    const state = { style, styleSelected: true, version: 2, answers: { tickets: { mode: 'manual' as const } } }
    expect(summarizeSetup(state, [], []).rows.find(row => row.key === 'tickets')?.action.href).toBe('/booking/menus?tab=passes')
  }
  expect(questionsFor('consult').find(q => q.key === 'payment')?.manualHref).toBe('/booking/menus?tab=payments')
  expect(setupLinksFor('consult').map(link => link.href)).toContain('/booking/menus?tab=staff')
  expect(setupLinksFor('lesson').map(link => link.href)).toContain('/events')
  expect(setupLinksFor('ec').map(link => link.href)).toContain('/ec-commerce?tab=auto-line')
  expect(featureHref('booking', undefined, 'lesson')).toBe('/events')
})

it('標準とECの質問に来店の文面を代用しない', () => {
  expect(questionsFor('standard').map(q => q.key)).toEqual(['content'])
  expect(questionsFor('ec').map(q => q.key)).toEqual(['coupons', 'content'])
  for (const style of ['standard', 'ec'] as const) expect(questionsFor(style).find(q => q.key === 'content')?.description).not.toMatch(/予約の確認|来店/)
})

it('支払いの札は共通辞書を使い、面談の担当を支払う場所に置き換えない', () => {
  const consult = questionsFor('consult').find(q => q.key === 'payment')!
  expect(consult.choices.find(choice => choice.value === 'store')?.label).toBe('当日払う')
  expect(consult.choices.map(choice => choice.note).join(' ')).not.toContain('担当で払')
  expect(questionsFor('lesson').find(q => q.key === 'payment')?.choices[0].label).toBe('お店で払う')
})

it('同じ保存用APIの解決済みボタンを使い、行き先なしを静的な6ボタンで補わない', async () => {
  net.starterSet.mockResolvedValueOnce({ success: true, data: { definition: { items: [] } } }).mockResolvedValueOnce({ success: true, data: { preview: [{ key: 'menu', buttons: [{ label: 'お問い合わせ', feature: 'contact', actionType: 'message', actionData: 'お問い合わせ' }] }] } })
  const view = renderHook(() => useStarterMenu('a', 'ec'))
  await waitFor(() => expect(view.result.current.error).toBeTruthy())
  expect(view.result.current.buttons).toEqual([])
  act(view.result.current.reload)
  await waitFor(() => expect(view.result.current.buttons).toHaveLength(1))
  expect(view.result.current.buttons[0].label).toBe('お問い合わせ')
})
