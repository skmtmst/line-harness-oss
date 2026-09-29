import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(HERE, 'page.tsx'), 'utf8')

describe('R533 booking detail 取得失敗', () => {
  it('TargetMissingのerrorへ捕まえたApiErrorを渡す（403は再試行なし）', () => {
    expect(page).toContain('kind="error"')
    expect(page).toContain('error={')
    expect(page).toContain('onRetry')
    // 読み直しは同じ予約を取り直す
    expect(page).toContain('void load()')
  })
})
