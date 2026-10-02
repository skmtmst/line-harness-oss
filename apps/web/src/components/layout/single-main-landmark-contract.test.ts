import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * ★V7（2026-09-24）：本文の目印（`<main>`）は共通の枠（app-shell の `#main-content`）に1つだけ置く。
 * 画面側でも `<main>` を書いていた30か所では、読み上げの「本文へ移動」が2つ出て、
 * どちらが本文か分からなかった。枠の外で描く画面（ログイン系・全体エラー・運営画面）だけ例外。
 */
const SRC = join(__dirname, '../..')
const ALLOWED = [
  'components/app-shell.tsx',
  'components/auth/auth-card.tsx',
  'components/ops/ops-shell.tsx',
  'app/global-error.tsx',
]
const ALLOWED_DIRS = ['app/login/', 'app/staff/invite/', 'app/staff/email-change/', 'app/visual-qa/']

describe('本文の目印は1つだけ', () => {
  it('共通の枠の中で描く画面は <main> を書かない', () => {
    const files = execSync('grep -rlE "<main[ >]" app components --include=*.tsx || true', { cwd: SRC, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .filter((f) => !/\.test\.|\.spec\./.test(f))
    const offenders = files.filter((f) => !ALLOWED.includes(f) && !ALLOWED_DIRS.some((d) => f.startsWith(d)))
    expect(offenders).toEqual([])
    expect(readFileSync(join(SRC, 'components/app-shell.tsx'), 'utf8')).toContain('id="main-content"')
  })
})
