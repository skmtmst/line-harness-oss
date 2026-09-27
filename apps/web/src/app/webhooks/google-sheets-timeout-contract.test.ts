import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PANEL = readFileSync(new URL('./google-sheets-panel.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8')

/*
 * R151: Google Sheets 連携の読み込みは期限付きにする。
 * 応答の無い通信をブラウザ任せにすると「読み込んでいます…」のまま
 * 60秒以上止まり、原因も再試行も出せない（監査の再現）。
 */
describe('R151 Google Sheets 連携の読み込みは期限付き', () => {
  it('接続状態と履歴の取得に打ち切り時刻を渡す', () => {
    expect(PANEL).toContain('AbortSignal.timeout(')
    expect(API).toMatch(/connection: \(lineAccountId: string, request\?: \{ signal\?: AbortSignal \}\)/)
    expect(API).toMatch(/runs: \(lineAccountId: string, request\?: \{ signal\?: AbortSignal \}\)/)
  })

  it('打ち切り・失敗・不正応答のどれでも読み込み状態を終えて再試行できる', () => {
    // 失敗系はすでに loadError → 再試行ボタンの経路がある。期限はその経路へ
    // 乗せるので、新しい分岐ではなく fetch の signal として渡す。
    expect(PANEL).toContain('api.webhooks.googleSheets.connection(requestAccountId, { signal })')
    expect(PANEL).toContain('api.webhooks.googleSheets.runs(requestAccountId, { signal })')
    expect(PANEL).toContain('loadError')
  })
})
