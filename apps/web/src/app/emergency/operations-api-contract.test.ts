import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const apiSource = readFileSync(join(process.cwd(), 'src/lib/api.ts'), 'utf8')
const pageSource = readFileSync(join(process.cwd(), 'src/app/emergency/page.tsx'), 'utf8')
const fixtureSource = readFileSync(join(process.cwd(), '../../scripts/visual-qa/fixtures.mjs'), 'utf8')
const mockSource = readFileSync(join(process.cwd(), '../../scripts/visual-qa/mock-api.mjs'), 'utf8')

describe('機能32のサーバー契約', () => {
  it('保存済みの健全性と手動サーバーチェックを選択中アカウントで読む', () => {
    expect(apiSource).toContain('/api/operations/health?account_id=')
    expect(apiSource).toContain("'/api/operations/health/runs'")
    expect(pageSource).toContain('accountId={selectedAccountId}')
    expect(pageSource).toContain('manualRunRequest={manualRunRequest}')
  })

  it('停止と復旧の直前に一回限りの再認証と再実行キーを渡す', () => {
    expect(apiSource).toContain("'/api/auth/step-up'")
    expect(apiSource).toContain("'X-Step-Up-Token': stepUpToken")
    expect(apiSource).toContain("'Idempotency-Key': idempotencyKey")
    expect(pageSource).toContain('api.operations.stepUp(stepUpCode)')
    expect(pageSource).toContain('setRequestKey(crypto.randomUUID())')
  })

  it('停止履歴と配備履歴を同じ応答から分けて表示する', () => {
    expect(apiSource).toContain("historyKind?: 'incident' | 'deployment'")
    expect(pageSource).toContain("item.historyKind !== 'deployment'")
    expect(pageSource).toContain("item.historyKind === 'deployment'")
  })

  it('自動更新では前回の結果を残し、初回確定後に深刻度を通知する(#518 中2)', () => {
    expect(pageSource).toContain('setRefreshing')
    expect(pageSource).toContain('hasLoaded')
    expect(pageSource).toContain('if (hasLoaded.current) onSeverity(displayedSeverity)')
    expect(pageSource).toContain("'更新中'")
  })

  it('履歴CSVは数式の先頭文字を無害化する(#518 中3)', () => {
    expect(pageSource).toContain('/^[=+\\-@]/')
  })

  it('目視用の履歴は historyKind と occurredAt を持ち、停止・復旧・手動チェックの口がある(#518 中5)', () => {
    expect(fixtureSource).toContain("historyKind: 'incident'")
    expect(fixtureSource).toContain("historyKind: 'deployment'")
    expect(fixtureSource).toContain('occurredAt:')
    expect(mockSource).toContain("'/api/operations/health/runs'")
    expect(mockSource).toContain("'/api/operations/incidents'")
    expect(mockSource).toContain('/restore')
  })
})
