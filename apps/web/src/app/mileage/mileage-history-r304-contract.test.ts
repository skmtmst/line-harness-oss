import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const TAB = readFileSync(join(HERE, 'mileage-history-tab.tsx'), 'utf8')

/*
 * R304: 履歴の日付が逆転すると入力エラーではなく取得失敗を案内する。
 * 振る舞いの本体は `mileage-history-period.test.ts` が、
 * 画面への配線はここが守る。
 */
describe('R304: 日付逆転は日付エラーとして表示し取得しない', () => {
  it('逆転しているときは口を呼ばずに終わる', () => {
    expect(TAB).toContain('validateHistoryPeriod(from, to)')
    expect(TAB).toMatch(/if \(validateHistoryPeriod\(from, to\)\) \{[\s\S]*?return[\s\S]*?\n    \}/)
  })

  it('開始日・終了日の欄を異常表示し、そばへ理由を出す', () => {
    expect(TAB).toContain('invalid={Boolean(periodError ?? inputRejected)}')
    expect(TAB).toContain('role="alert"')
  })

  it('口の入力エラー（400）は通信障害と分け、日付エラーとして扱う', () => {
    expect(TAB).toContain('caught instanceof ApiError && caught.status === 400')
    expect(TAB).toContain('setInputRejected')
  })

  it('逆転中は取得失敗の再読み込みを出さない', () => {
    expect(TAB).toContain('日付の条件を確認してください')
  })
})
