/*
 * IDEA-07: イベントの予約ごとの通知予定を、予約そのもののそばで見せる。
 *
 * 開催回の移動・予約の取消で止まった分も「停止済み」として出すので、
 * 古い通知が残っていないか・二重になっていないかをこの一覧で確かめられる。
 * 変更に連動しない別管理の通知一覧は作らない（指示の除外範囲）。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const API = readFileSync(join(HERE, '..', '..', '..', 'lib', 'api.ts'), 'utf8')
const WORKER = readFileSync(
  join(HERE, '..', '..', '..', '..', '..', 'worker', 'src', 'routes', 'events.ts'),
  'utf8',
)

/** 説明の文だけで通ってしまわないよう、判定の前にコメントを落とす。 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('IDEA-07 イベント予約の通知予定', () => {
  it('一覧APIが予約ごとの通知予定を同じ応答で返す', () => {
    const worker = code(WORKER)
    // 表示中のページ分だけを1回で取る。1行ずつ取る形にはしない。
    expect(worker).toContain('FROM event_booking_reminders')
    expect(worker).toContain('booking_id IN (')
    expect(worker).toContain('reminders: remindersByBooking.get(row.id)')
    // 画面の型にも予定と状態が載る。
    expect(code(API)).toContain('reminders?:')
    expect(code(API)).toContain("'pending' | 'sent' | 'failed' | 'failed_permanent' | 'cancelled'")
  })

  it('予約枠のそばに通知の種類・日時・状態を出す', () => {
    const page = code(PAGE)
    expect(page).toContain('b.reminders')
    expect(page).toContain('data-booking-reminders')
    expect(page).toContain('REMINDER_KIND_LABELS[reminder.kind]')
    expect(page).toContain('REMINDER_STATUS_LABELS[reminder.status]')
    expect(page).toContain('formatJp(reminder.scheduled_at')
  })

  it('止まった分は「停止済み」、送った分は「送信済み」と区別する', () => {
    expect(PAGE).toContain('前日のお知らせ')
    expect(PAGE).toContain('開始前のお知らせ')
    expect(PAGE).toContain('送信予定')
    expect(PAGE).toContain('送信済み')
    expect(PAGE).toContain('停止済み')
    // 失敗は別の状態名で出し、送信予定と混ぜない。
    expect(PAGE).toContain('failed_permanent')
  })

  it('変更に連動しない別管理の通知一覧は増やさない', () => {
    const page = code(PAGE)
    // 通知予定は予約の行の中だけ。独立した一覧口は呼ばない。
    expect(page).not.toContain('notifications/pending')
    expect(page).not.toContain('/api/reminders')
  })
})
