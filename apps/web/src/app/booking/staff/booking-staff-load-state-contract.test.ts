import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const STAFF = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const SHIFTS = readFileSync(join(HERE, '../../../v8/booking-menus/settings.tsx'), 'utf8')
const HOURS = readFileSync(join(HERE, '../../../v8/booking-menus/tabs/hours-tab.tsx'), 'utf8')

describe('V8 予約スタッフ・受付時間の一覧状態', () => {
  for (const [name, source] of [['予約スタッフ', STAFF], ['受付時間', SHIFTS]] as const) {
    it(`${name}は読込・成功・失敗を別の状態として持つ`, () => {
      expect(source).toContain("type LoadStatus = 'loading' | 'ready' | 'error'")
      expect(source).toContain(name === '受付時間' ? "setSettingsStatus('ready')" : "setLoadStatus('ready')")
      expect(source).toContain(name === '受付時間' ? "setSettingsStatus('error')" : "setLoadStatus('error')")
      expect(source.indexOf(name === '受付時間' ? "settingsStatus === 'error'" : "loadStatus === 'error'")).toBeGreaterThan(-1)
    })

    it(`${name}は失敗時に再読み込みできる`, () => {
      expect(source).toContain('kind="error"')
      if (name === '受付時間') {
        expect(source).toContain('onClick={onReload}')
      } else {
        expect(source).toContain('onClick={() => void load()}')
      }
      expect(source).toContain(name === '受付時間' ? 'onReload={reloadCore}' : '再読み込み</Button>')
    })

    it(`${name}はアカウント切替前の遅い応答を採用しない`, () => {
      if (name === '受付時間') {
        expect(source).toContain('const generationRef = useRef(0)')
        expect(source).toContain('const generation = ++generationRef.current')
        expect(source).toContain('const alive = () => generationRef.current === generation')
        expect(source).toContain('if (!alive()) return')
        return
      }
      const requestRef = 'loadRequestRef'
      expect(source).toContain(`const ${requestRef} = useRef(0)`)
      expect(source).toContain(`if (requestId !== ${requestRef}.current) return`)
      expect(source).toContain(`${requestRef}.current += 1`)
    })
  }

  it('予約スタッフは失敗を0件や作成誘導に見せない', () => {
    const errorBranch = STAFF.indexOf("loadStatus === 'error'")
    const emptyBranch = STAFF.indexOf('items.length === 0')
    expect(errorBranch).toBeGreaterThan(-1)
    expect(emptyBranch).toBeGreaterThan(errorBranch)
    expect(STAFF).toContain('登録したスタッフは消えていません。')
    expect(STAFF).toContain("disabled={!canManageStaff || !selectedAccountId || loadStatus !== 'ready'}")
  })

  it('受付時間は読込失敗時に初期値の設定画面を出さない', () => {
    const errorBranch = HOURS.indexOf("settingsStatus === 'error'")
    const contentBranch = HOURS.indexOf('data-design="Week"')
    expect(errorBranch).toBeGreaterThan(-1)
    expect(contentBranch).toBeGreaterThan(errorBranch)
    expect(HOURS).toContain('受付枠を読み込めませんでした')
  })

  it('休業日の保存失敗で内部のエラー文をそのまま出さない', () => {
    expect(SHIFTS).not.toContain("setError(e instanceof Error ? e.message : String(e))")
    expect(SHIFTS).toContain('休業日を保存できませんでした。')
    expect(SHIFTS).toContain('bookingApi.createException(accountId')
  })
})
