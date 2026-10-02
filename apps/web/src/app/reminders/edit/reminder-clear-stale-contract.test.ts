import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(HERE, 'issue469-reminder-screens.tsx'), 'utf8')

describe('reminders/edit 古い失敗文を残さない', () => {
  it('読み直しの成功・再試行で古い失敗文を消す', () => {
    const start = src.indexOf('const loadDraft')
    expect(start).toBeGreaterThanOrEqual(0)
    const body = src.slice(start, start + 2000)
    // 読み直し開始・成功で失敗文を消す（staleな赤字を残さない）
    expect(body).toContain("setError('')")
  })
})
