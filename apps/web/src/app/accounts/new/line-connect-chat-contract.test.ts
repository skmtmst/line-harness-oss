import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const MANUAL = readFileSync(join(ROOT, 'public', 'manuals', 'line-connect', 'index.html'), 'utf8')
const MANUAL_DOC = readFileSync(join(ROOT, '..', '..', 'docs', 'manuals', 'line-connect', 'index.html'), 'utf8')
const ROUTE = readFileSync(join(ROOT, '..', 'worker', 'src', 'routes', 'line-accounts.ts'), 'utf8')

/*
 * R175: LINEは2022-11-30からチャットとWebhookの併用をサポートしている。
 * 「チャットをオンにするとメッセージが届かない」と書くと、LINE側の
 * チャットで対応している店舗が誤ってチャットを切る。切るべきなのは
 * 自動返信（あいさつ・応答メッセージ）の重複だけ。
 */
describe('R175 LINE接続の案内はチャットとWebhookの併用を妨げない', () => {
  it('マニュアルはチャットONで受信不可とは書かない', () => {
    for (const src of [MANUAL, MANUAL_DOC]) {
      expect(src).not.toContain('オンにすると musubo にメッセージが届きません')
      expect(src).not.toContain('「チャット」はオフのままにしてください')
      // 併用できることと、二重返信への注意を書く。
      expect(src).toContain('オンのままでも musubo にメッセージは届きます')
    }
  })

  it('接続後の案内もチャットを切らせず、自動返信の確認だけを残す', () => {
    expect(ROUTE).not.toContain('チャットをオフにしてください')
    expect(ROUTE).toContain('受信はそのまま動きます')
  })
})
