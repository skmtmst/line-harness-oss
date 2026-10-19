import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(new URL('../../app/users/users-screen.tsx', import.meta.url), 'utf8')
const ROW = PAGE
const TABLE = PAGE
const SUMMARY = PAGE
const FILTERS = PAGE
const HOOK = readFileSync(join(HERE, 'use-users-summary.ts'), 'utf8')

describe('統合ユーザーV8の画面契約', () => {
  it('内部の統合キーを画面へ出さない', () => {
    expect(ROW).not.toMatch(/>\s*\{row\.identityKey\}/)
    expect(ROW).not.toMatch(/>\s*\{row\.identityKeyKind\}/)
    expect(ROW).not.toContain('shortenUid')
    expect(ROW).not.toContain('title={a.lineUserId}')
    expect(ROW).toContain("expanded === row.identityKey ? '閉じる' : '開く'")
    expect(PAGE).not.toContain('画像トークン')
    expect(PAGE).not.toContain('worker キャッシュ')
    expect(FILTERS).toContain('aria-label="UID連携で絞り込む"')
  })

  it('複数登録を配信済みと決めつけず要確認として出す', () => {
    expect(ROW).toContain('{row.isDuplicate ? (')
    expect(ROW).toContain('tone="warning"')
    expect(ROW).not.toContain('2通→1通')
    expect(ROW).toContain('送信前に配信先の確認が必要です')
  })

  it('空・読込・失敗を同じ表示にしない', () => {
    expect(TABLE).toContain('u.loading && u.rows.length === 0')
    expect(TABLE).toContain('u.error ? (')
    expect(TABLE).toContain('onClick={() => u.load()}')
    expect(TABLE).toContain('条件に合う人はいません')
    expect(TABLE).toContain('統合ユーザーを読み込めませんでした')
    expect(TABLE).toContain("u.error ? '—人'")
  })

  it('KPI名を統合ユーザーの業務用語へそろえる', () => {
    for (const label of ['統合ユーザー', '紐付く友だち', 'UID連携済み']) expect(SUMMARY).toContain(label)
    expect(SUMMARY).not.toContain('title="重複配信の削減"')
    expect(SUMMARY).not.toContain('余分な行数')
    expect(SUMMARY).not.toContain('余分率')
  })

  it('KPIの読み込み中・取得失敗・取得成功を分け、失敗を0件にしない', () => {
    expect(HOOK).toContain("type LoadStatus = 'loading' | 'ready' | 'error'")
    expect(SUMMARY).toContain('useUsersSummary()')
    expect(SUMMARY).toContain('summary.stats?.uniquePeople ?? null')
    expect(SUMMARY).toContain("summary.status === 'error'")
    expect(SUMMARY).toContain('summary.load()')
    expect(HOOK).toContain('setStats(null)')
    expect(HOOK).toContain('requestGuard.isCurrent(requestGeneration)')
  })
})
