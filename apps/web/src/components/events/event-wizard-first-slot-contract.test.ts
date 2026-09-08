import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(HERE, 'event-wizard.tsx'), 'utf8')

describe('V6 イベント作成の最初の予約枠', () => {
  it('概要と同じ画面で日時・所要時間・定員を入力できる', () => {
    expect(SOURCE).toContain('label="最初の予約枠"')
    expect(SOURCE).toContain('id="first-slot-date"')
    expect(SOURCE).toContain('id="first-slot-start"')
    expect(SOURCE).toContain('id="first-slot-duration"')
    expect(SOURCE).toContain('id="first-slot-capacity"')
  })

  it('イベント作成後のIDを使って最初の枠も保存する', () => {
    const createEvent = SOURCE.indexOf('eventsApi.createEvent(accountId, payloadOf(draft))')
    const createSlot = SOURCE.indexOf('eventsApi.createSlots(accountId, id, [slotPayload])')
    expect(createEvent).toBeGreaterThanOrEqual(0)
    expect(createSlot).toBeGreaterThan(createEvent)
  })

  it('入力と同じ内容をお客様向けプレビューに出す', () => {
    expect(SOURCE).toContain('お客様のLINEではこう見えます')
    expect(SOURCE).toContain("draft.name.trim() || 'イベント名'")
    expect(SOURCE).toContain('previewDate')
    expect(SOURCE).toContain('previewCapacity')
  })

  it('一括の作りすぎは下見の前に500件で止める(点検#520の中9)', () => {
    expect(SOURCE).toContain('generated.length > 500')
    expect(SOURCE).toContain('500件を超える一括作成はできません')
  })
})
