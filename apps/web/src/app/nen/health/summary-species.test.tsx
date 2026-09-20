// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// nen-pets-api.ts は '@/lib/api' を読み、未設定の NEXT_PUBLIC_API_URL で
// モジュール評価が落ちる。種別ラベルの試験には通信層が要らないので空で差し替える。
vi.mock('@/lib/api', () => ({ fetchApi: vi.fn() }))

import { petAnimalTypeLabel } from '@/lib/nen-pets-api'
import { SummarySheet } from './summary-drawer'

afterEach(cleanup)

const baseSummary = {
  pet: { id: 'p1', name: 'モカ', callName: 'モカちゃん', animalType: 'other', breed: 'うさぎ', ageLabel: '1歳', weightKg: 2 },
  owner: { friendId: 'f1', name: '飼い主' },
  generatedAt: '2026-09-20T00:00:00Z',
  labels: { stool: {}, appetite: {} },
  summary: {
    records: 0, days: 0, weight: null, heartRateAvg: null, respiratoryRateAvg: null,
    stool: {}, appetite: {}, skin: {}, tearStain: {}, notes: [], logs: [],
  },
}

describe('動物種別の保持（#999 DEEP-24）', () => {
  it('共通ラベルは「その他」を犬へ変換しない', () => {
    expect(petAnimalTypeLabel('dog')).toBe('犬')
    expect(petAnimalTypeLabel('cat')).toBe('猫')
    expect(petAnimalTypeLabel('other')).toBe('その他')
    // 見知らぬ値は犬へ倒さず原文を保持する
    expect(petAnimalTypeLabel('rabbit')).toBe('rabbit')
  })

  it('30日のまとめ印刷面で、その他の動物は「その他」と出る', () => {
    render(<SummarySheet summary={baseSummary as never} />)
    const sheet = document.querySelector('[data-print-sheet]')
    expect(sheet?.textContent).toContain('モカちゃん（その他・うさぎ・1歳）')
    expect(sheet?.textContent).not.toContain('（犬・')
  })
})
