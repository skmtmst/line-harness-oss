import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseFriendCsv } from './friend-csv'
import { parseUidCsv } from '../../accounts/migration'

const HERE = dirname(fileURLToPath(import.meta.url))
const CSV_PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const UID_PAGE = readFileSync(join(HERE, '../../accounts/migration.tsx'), 'utf8')

describe('V6 機能3 UID・CSV移行', () => {
  it('UID対応表の必須列を読み取る', () => {
    expect(parseUidCsv('old_uid,new_uid\nold-1,new-1')).toEqual([
      { oldUid: 'old-1', newUid: 'new-1', evidenceType: 'operator_csv' },
    ])
  })

  it('Harnessの書き出しCSVを取り込める', () => {
    expect(parseFriendCsv('LINEユーザーID,LINE表示名,本名,システム表示名\nU1,山田,山田 太郎,たろう')).toEqual([
      { lineUid: 'U1', displayName: '山田', realName: '山田 太郎', systemDisplayName: 'たろう' },
    ])
  })

  it('引用符内のカンマと二重引用符を保ったまま取り込める', () => {
    expect(parseFriendCsv('LINEユーザーID,LINE表示名,本名,システム表示名\nU1,"山田,太郎","山田 ""T"" 太郎",たろう')).toEqual([
      { lineUid: 'U1', displayName: '山田,太郎', realName: '山田 "T" 太郎', systemDisplayName: 'たろう' },
    ])
  })

  it('通常・読込・空・失敗を別の文で持つ', () => {
    expect(UID_PAGE).toContain('UID移行を読み込んでいます')
    expect(UID_PAGE).toContain('UID移行を表示できませんでした')
    expect(UID_PAGE).toContain('テスト移行はまだありません')
    expect(UID_PAGE).toContain('テスト移行の状態')
    expect(CSV_PAGE).toContain('書き出し・取り込みを読み込んでいます')
    expect(CSV_PAGE).toContain('書き出し・取り込みを表示できませんでした')
    expect(CSV_PAGE).toContain('履歴はまだありません')
  })

  it('事前確認と未取得値を区別する', () => {
    expect(UID_PAGE).toContain('実データはまだ変更していません')
    expect(UID_PAGE).toContain("unresolved ?? '—'")
    expect(CSV_PAGE).toContain("job.row_count ?? job.total_count ?? '—'")
  })

  it('設計Nodeと本物のAPIに接続する', () => {
    expect(UID_PAGE).toContain('data-design-node="vtBCu"')
    expect(CSV_PAGE).toContain('data-design-node="ux7of"')
    expect(UID_PAGE).toContain('api.friendMigrations.dryRun')
    expect(CSV_PAGE).toContain('api.friendMigrations.previewImport')
  })
})
