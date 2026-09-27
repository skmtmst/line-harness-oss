import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * R11: 一覧の行を押すと、その物の詳細へ（別の画面へ飛ばない）。名前は黒文字。
 * 予約一覧では行の物は予約のため、お客さま名から受信箱へ飛ばさない。
 * 受信箱への行き先は操作列の「会話」ボタンに寄せる。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

describe('予約一覧の行の行き先（R11）', () => {
  it('お客さま名は青リンクにしない', () => {
    expect(PAGE).not.toContain('text-blue-600')
  })

  it('予約の詳細はその場のパネルで開く', () => {
    expect(PAGE).toContain('setDetailId(b.id)')
    expect(PAGE).toContain('BookingDetailPanel')
  })

  it('受信箱への行き先は操作列の会話ボタンから行ける', () => {
    expect(PAGE).toContain('さんとの会話を受信箱で開く')
    expect(PAGE).toContain('`/chats?friend=${b.friend_id}`')
  })
})
