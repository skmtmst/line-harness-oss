// @vitest-environment happy-dom
/*
 * はじめにやることは「閉じる」ではなく畳める（オーナー 2026-10-08・絵 r3X34 の「畳む ⌃」、畳んだ形は DIHFx A9uRGq）。
 * 畳む→頭の1行だけ・開く→手順が戻る・アカウントごとに覚える・前の「閉じる」は畳んだ形で出す、を見張る。
 */
import { act, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FirstStepsCard, firstStepsLegacyDismissedKey, firstStepsStorageKey, readFirstStepsFolded, summarizeFirstSteps } from './first-steps'

const summary = summarizeFirstSteps({ connect: false, greeting: true, richMenu: false, broadcast: false, scenario: false, invite: true })!

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => store.clear(),
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Host({ initial = false }: { initial?: boolean }) {
  const [folded, setFolded] = useState(initial)
  return <FirstStepsCard summary={summary} folded={folded} onToggle={() => setFolded((current) => !current)} />
}

describe('はじめにやることを畳む', () => {
  it('「畳む」で手順が隠れて「開く」に替わり、もう一度押すと戻る。閉じるの文字は無い', async () => {
    await act(async () => { render(<Host />) })
    expect(screen.queryByRole('button', { name: '閉じる' })).toBeNull()
    const fold = screen.getByRole('button', { name: '畳む' })
    expect(fold.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('LINE 公式アカウントをつなぐ')).toBeTruthy()
    await act(async () => { fireEvent.click(fold) })
    const open = screen.getByRole('button', { name: '開く' })
    expect(open.getAttribute('aria-expanded')).toBe('false')
    expect((document.getElementById('first-steps-list') as HTMLElement).hidden).toBe(true)
    // 畳んでも頭の1行（題・数・進み）は残る。
    expect(screen.getByRole('heading', { name: 'はじめにやること' })).toBeTruthy()
    expect(screen.getByText('2 / 6 済み')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'はじめにやることの進み' })).toBeTruthy()
    await act(async () => { fireEvent.click(open) })
    expect((document.getElementById('first-steps-list') as HTMLElement).hidden).toBe(false)
  })

  it('畳んだかはアカウントごとに覚え、前に「閉じる」を押した人は畳んだ形で出す', () => {
    expect(readFirstStepsFolded('acc-1')).toBe(false)
    window.localStorage.setItem(firstStepsLegacyDismissedKey('acc-1'), '1')
    expect(readFirstStepsFolded('acc-1')).toBe(true)
    // 一度「開く」を押したら、前の印より新しい印を優先する。
    window.localStorage.setItem(firstStepsStorageKey('acc-1'), '0')
    expect(readFirstStepsFolded('acc-1')).toBe(false)
    window.localStorage.setItem(firstStepsStorageKey('acc-2'), '1')
    expect(readFirstStepsFolded('acc-2')).toBe(true)
    expect(readFirstStepsFolded('acc-3')).toBe(false)
    expect(readFirstStepsFolded(null)).toBe(false)
  })
})
