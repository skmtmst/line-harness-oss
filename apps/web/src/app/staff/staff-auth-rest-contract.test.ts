import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const STAFF_DIR = dirname(fileURLToPath(import.meta.url))
const apiSource = readFileSync(join(STAFF_DIR, '../../lib/api.ts'), 'utf8')
const auditSource = readFileSync(join(STAFF_DIR, '../../components/staff/login-audit.tsx'), 'utf8')

describe('ログインユーザーの残りの画面契約', () => {
  it('存在しないAPIキー再発行の口を公開しない', () => {
    expect(apiSource).not.toContain('regenerateKey:')
    expect(apiSource).not.toContain('/regenerate-key')
  })

  it('監査APIが失敗応答を返したら古い行を消して理由を表示する', () => {
    expect(auditSource).toMatch(/if \(auditResult\.success\)[\s\S]*else \{[\s\S]*setRows\(\[\]\)/)
    expect(auditSource).toContain("setError(auditResult.error")
    expect(auditSource).toContain("caught instanceof ApiError && caught.status === 403")
  })
})
