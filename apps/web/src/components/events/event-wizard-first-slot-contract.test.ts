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
    // #1000: 初回枠には固定の再送防止キーを付け、作成済みの枠ID
    // (firstSlotId)だけを更新対象にする。slots[0] の位置では識別しない。
    const createSlot = SOURCE.indexOf('eventsApi.createSlots(accountId, id, [')
    const firstSlotGuard = SOURCE.indexOf('firstSlotId && slots.some(')
    expect(createEvent).toBeGreaterThanOrEqual(0)
    expect(createSlot).toBeGreaterThan(createEvent)
    expect(firstSlotGuard).toBeGreaterThan(createEvent)
  })

  it('入力と同じ内容をお客様向けプレビューに出す', () => {
    expect(SOURCE).toContain('お客様のLINEではこう見えます')
    expect(SOURCE).toContain("draft.name.trim() || 'イベント名'")
    expect(SOURCE).toContain('previewDate')
    expect(SOURCE).toContain('previewCapacity')
  })

  it('一括の作りすぎは下見の前に500件で止める(点検#520の中9)', () => {
    // #1000: 上限値は bulk-slot-generator の BULK_SLOT_LIMIT が正本。
    // 下見・送信・生成の3か所で同じ制限を使う。
    expect(SOURCE).toContain('generated.length > BULK_SLOT_LIMIT')
    expect(SOURCE).toContain('500件を超える一括作成はできません')
  })
})
