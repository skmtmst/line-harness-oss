import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const STAFF = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const SHIFTS = readFileSync(join(HERE, 'shifts', 'page.tsx'), 'utf8')

describe('V6 予約スタッフ・受付時間の一覧状態', () => {
  for (const [name, source] of [['予約スタッフ', STAFF], ['受付時間', SHIFTS]] as const) {
    it(`${name}は読込・成功・失敗を別の状態として持つ`, () => {
      expect(source).toContain("type LoadStatus = 'loading' | 'ready' | 'error'")
      expect(source).toContain("setLoadStatus('ready')")
      expect(source).toContain("setLoadStatus('error')")
      expect(source.indexOf("loadStatus === 'error'")).toBeGreaterThan(-1)
    })

    it(`${name}は失敗時に再読み込みできる`, () => {
      expect(source).toContain('kind="error"')
      expect(source).toContain('onClick={() => void load()}')
      expect(source).toContain('再読み込み</Button>')
    })

    it(`${name}はアカウント切替前の遅い応答を採用しない`, () => {
      expect(source).toContain('const loadRequestRef = useRef(0)')
      expect(source).toContain('if (requestId !== loadRequestRef.current) return')
      expect(source).toContain('loadRequestRef.current += 1')
    })
  }

  it('予約スタッフは失敗を0件や作成誘導に見せない', () => {
    const errorBranch = STAFF.indexOf("loadStatus === 'error'")
    const emptyBranch = STAFF.indexOf('items.length === 0')
    expect(errorBranch).toBeGreaterThan(-1)
    expect(emptyBranch).toBeGreaterThan(errorBranch)
    expect(STAFF).toContain('登録したスタッフは消えていません。')
    expect(STAFF).toContain("disabled={!selectedAccountId || loadStatus !== 'ready'}")
  })

  it('受付時間は読込失敗時に初期値の設定画面を出さない', () => {
    const errorBranch = SHIFTS.indexOf("loadStatus === 'error' && loadError")
    const contentBranch = SHIFTS.indexOf('<div className="space-y-4">')
    expect(errorBranch).toBeGreaterThan(-1)
    expect(contentBranch).toBeGreaterThan(errorBranch)
    expect(SHIFTS).toContain('保存済みの設定は消えていません。')
  })

  it('受付時間の保存・接続失敗で内部のエラー文をそのまま出さない', () => {
    expect(SHIFTS).not.toContain("setError(e instanceof Error ? e.message : String(e))")
    expect(SHIFTS).toContain('受付時間を保存できませんでした。')
    expect(SHIFTS).toContain('Googleカレンダーへ接続できませんでした。')
  })
})
