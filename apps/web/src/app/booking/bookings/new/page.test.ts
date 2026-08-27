import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const LIST = readFileSync(new URL('../page.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../../../lib/api.ts', import.meta.url), 'utf8')

describe('V6 代理予約の接続契約', () => {
  test('入力・確認・完了・競合の実Nodeを同じフローで持つ', () => {
    for (const node of ['cpdDi', 'GFDqW', 'GfceK', 'Lg8ff']) {
      expect(PAGE).toContain(node)
    }
  })

  test('一覧の作成操作は準備中ではなく代理予約へ進む', () => {
    expect(LIST).toContain('href="/booking/bookings/new"')
    expect(LIST).toContain('電話の予約を入れる')
    expect(LIST).not.toContain('管理画面から予約を代理で入れる仕組みは準備中です')
  })

  test('確定APIはIdempotency-Keyを必ず送る', () => {
    expect(API).toContain("headers: { 'Idempotency-Key': idempotencyKey }")
    expect(PAGE).toContain('crypto.randomUUID()')
  })

  test('送信時刻を画面へ固定せず、未取得を明示する', () => {
    expect(PAGE).toContain('—（完了APIへの接続が必要）')
    expect(PAGE).not.toContain('前日19:00')
    expect(PAGE).not.toContain('当日8:00')
  })
})
