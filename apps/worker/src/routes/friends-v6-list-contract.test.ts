import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'friends.ts'), 'utf8')
const CHATS_SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'chats.ts'), 'utf8')

describe('V6友だち一覧API契約', () => {
  it('担当者とシナリオをページング前のSQLで絞る', () => {
    expect(SOURCE).toContain("c.req.query('operatorId')")
    expect(SOURCE).toContain("c.req.query('scenarioId')")
    expect(SOURCE).toContain('WHERE c.friend_id = f.id AND c.operator_id = ?')
    expect(SOURCE).toContain('SELECT 1 FROM friend_scenarios fs')
    expect(SOURCE).toContain("fs.status IN ('active', 'delivering')")
  })

  it('一覧行へ担当者と対応マークを既存データから返す', () => {
    expect(SOURCE).toContain('LEFT JOIN chats lc ON lc.friend_id = f.id')
    expect(SOURCE).toContain('LEFT JOIN operators op ON op.id = lc.operator_id')
    expect(SOURCE).toContain('LEFT JOIN support_marks sm ON sm.id = f.support_mark_id')
    expect(SOURCE).toContain('operator:')
    expect(SOURCE).toContain('supportMark:')
  })

  it('注目を外すとmetadataのキー自体を削除する', () => {
    expect(SOURCE).toContain('if (value === null) delete merged[key]')
    expect(SOURCE).toContain("metadata values must be string or null")
  })

  it('担当者名簿を友だち一覧と同じ権限に限定する', () => {
    expect(CHATS_SOURCE).toContain(
      "chats.get('/api/operators', requireRole('owner', 'admin', 'staff')",
    )
  })
})
