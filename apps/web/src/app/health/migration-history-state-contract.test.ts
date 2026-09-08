import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('/health のUID移行履歴状態契約', () => {
  it('成功0件だけを「移行履歴はありません」と表示する', () => {
    expect(PAGE).toContain("type MigrationLoadState = 'loading' | 'ready' | 'error'")
    expect(PAGE).toContain("setMigrationLoadState('ready')")
    expect(PAGE).toContain(") : migrations.length === 0 ? (")
    expect(PAGE).toContain('移行履歴はありません')
  })

  it('成功複数件は移行履歴を描画する', () => {
    expect(PAGE).toContain('res.success && Array.isArray(res.data)')
    expect(PAGE).toContain('setMigrations(res.data as AccountMigration[])')
    expect(PAGE).toContain('{migrations.map((migration) => {')
  })

  it('API失敗を空表示と分け、同じ画面で再読み込みできる', () => {
    expect(PAGE.match(/setMigrationLoadState\('error'\)/g)).toHaveLength(2)
    expect(PAGE).toContain("migrationLoadState === 'error'")
    expect(PAGE).toContain('移行履歴を取得できませんでした。')
    expect(PAGE).toContain('onClick={() => void loadMigrations()}')
    expect(PAGE).toContain('再読み込み')
  })
})
